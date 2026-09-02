import assert from 'node:assert/strict';
import test from 'node:test';
import type { LogTransport } from './contracts';
import {
  createGcpOrchestratorIdentityHeaders,
  gcpStartFailurePolicy,
  gcpStartFailureResult,
  invokeOrchestratorService,
  isAmbiguousOrchestratorInvocationError,
  missingRunnerSettings,
  waitForOrchestratorServiceReady,
} from './gcp-workflow-execution';

test('custom orchestrator launchers do not require Cloud Run Service settings', () => {
  const settings = {
    cloudRunLocation: 'australia-southeast1',
    playwrightImageUriTemplate: 'example/playwright:latest',
  };
  assert.deepEqual(missingRunnerSettings(settings, true), []);
  assert.deepEqual(missingRunnerSettings(settings), [
    'Orchestrator service name',
    'Orchestrator minimum instance count',
    'Orchestrator maximum instance count',
    'Orchestrator CPU idle policy',
    'Orchestrator image URI template',
  ]);
});

test('renders the custom orchestrator target in definite failures', () => {
  assert.deepEqual(
    gcpStartFailureResult(
      new Error('job rejected'),
      'execution-job',
      'Cloud Run Job',
    ),
    {
      body: {
        error: 'Failed to trigger Cloud Run Job: job rejected',
        testId: 'execution-job',
      },
      status: 500,
    },
  );
});

const logTransport: LogTransport = {
  publish: async () => undefined,
  setup: async () => undefined,
};
const identityHeaders = { Authorization: 'Bearer test.identity.token' };

function identityToken(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'signature',
  ].join('.');
}

test('mints an audience-bound ID token only from the configured server ADC identity', async () => {
  const audience = 'https://orchestrator.example.run.app';
  const email = 'playrunner-api@example.iam.gserviceaccount.com';
  const subject = '123456789012345678901';
  const calls: string[] = [];
  const token = identityToken({
    aud: audience,
    email,
    email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iss: 'https://accounts.google.com',
    sub: subject,
  });
  const auth = {
    async getCredentials() {
      return { client_email: email };
    },
    async getIdTokenClient(targetAudience: string) {
      calls.push(targetAudience);
      return {
        async getRequestHeaders(requestAudience: string) {
          calls.push(requestAudience);
          return new Headers({ Authorization: `Bearer ${token}` });
        },
      };
    },
  };

  assert.deepEqual(
    await createGcpOrchestratorIdentityHeaders(
      {
        audience,
        callerServiceAccountEmail: email,
        callerServiceAccountSubject: subject,
      },
      auth as never,
    ),
    { Authorization: `Bearer ${token}` },
  );
  assert.deepEqual(calls, [audience, audience]);
});

test('refuses user ADC or a token for a different hosted identity', async () => {
  await assert.rejects(
    createGcpOrchestratorIdentityHeaders(
      {
        audience: 'https://orchestrator.example.run.app',
        callerServiceAccountEmail:
          'playrunner-api@example.iam.gserviceaccount.com',
        callerServiceAccountSubject: '123456789012345678901',
      },
      {
        async getCredentials() {
          return {};
        },
        async getIdTokenClient() {
          throw new Error('must not be reached');
        },
      } as never,
    ),
    /do not match the configured GCP orchestrator caller/,
  );
});

test('authenticates the private orchestrator health request with the ID token', async () => {
  let observedHeaders: HeadersInit | undefined;
  await waitForOrchestratorServiceReady(
    'https://orchestrator.test',
    identityHeaders,
    logTransport,
    'execution-health',
    'workflow-1',
    (async (_input, init) => {
      observedHeaders = init?.headers;
      return new Response('healthy', { status: 200 });
    }) as typeof fetch,
  );
  assert.equal(
    (observedHeaders as Record<string, string>).Authorization,
    identityHeaders.Authorization,
  );
});

test('treats a lost invocation response as ambiguous and preserves runner resources', async () => {
  let caught: unknown;
  let invocationCount = 0;
  try {
    await invokeOrchestratorService(
      'https://orchestrator.test',
      { testId: 'execution-1' },
      identityHeaders,
      logTransport,
      'execution-1',
      'workflow-1',
      (async (_input, init) => {
        invocationCount++;
        assert.equal(
          (init?.headers as Record<string, string>).Authorization,
          identityHeaders.Authorization,
        );
        throw new Error('socket closed before a response arrived');
      }) as typeof fetch,
    );
  } catch (error) {
    caught = error;
  }

  assert.equal(invocationCount, 1);
  assert.equal(isAmbiguousOrchestratorInvocationError(caught), true);
  assert.deepEqual(gcpStartFailurePolicy(caught), {
    cleanupResources: false,
    eventType: 'log',
  });
  assert.deepEqual(gcpStartFailureResult(caught, 'execution-1'), {
    body: {
      execution: 'service-invocation',
      invocationOutcome: 'unknown',
      message:
        'The Cloud Run invocation response was lost. The workflow may already be running; poll this execution for updates. It will not be retried automatically.',
      testId: 'execution-1',
    },
    status: 202,
  });
});

for (const status of [408, 429, 500, 501, 502, 503, 504, 599]) {
  test(`does not retry ambiguous orchestrator HTTP ${status} responses`, async () => {
    let caught: unknown;
    let invocationCount = 0;
    try {
      await invokeOrchestratorService(
        'https://orchestrator.test',
        { testId: `execution-${status}` },
        identityHeaders,
        logTransport,
        `execution-${status}`,
        'workflow-1',
        (async () => {
          invocationCount++;
          return new Response('outcome unknown', {
            status,
            statusText: 'Invocation failed',
          });
        }) as typeof fetch,
      );
    } catch (error) {
      caught = error;
    }

    assert.equal(invocationCount, 1);
    assert.equal(isAmbiguousOrchestratorInvocationError(caught), true);
    assert.deepEqual(gcpStartFailurePolicy(caught), {
      cleanupResources: false,
      eventType: 'log',
    });
  });
}

test('treats an explicit non-retryable orchestrator rejection as terminal', async () => {
  let caught: unknown;
  let invocationCount = 0;
  try {
    await invokeOrchestratorService(
      'https://orchestrator.test',
      { testId: 'execution-2' },
      identityHeaders,
      logTransport,
      'execution-2',
      'workflow-1',
      (async () => {
        invocationCount++;
        return new Response('request rejected', {
          status: 400,
          statusText: 'Bad Request',
        });
      }) as typeof fetch,
    );
  } catch (error) {
    caught = error;
  }

  assert.equal(invocationCount, 1);
  assert.equal(isAmbiguousOrchestratorInvocationError(caught), false);
  assert.match(String(caught), /400 Bad Request: request rejected/);
  assert.deepEqual(gcpStartFailurePolicy(caught), {
    cleanupResources: true,
    eventType: 'workflow_failed',
  });
  assert.deepEqual(gcpStartFailureResult(caught, 'execution-2'), {
    body: {
      error:
        'Failed to trigger Cloud Run Service: Failed to execute orchestrator service: 400 Bad Request: request rejected',
      testId: 'execution-2',
    },
    status: 500,
  });
});
