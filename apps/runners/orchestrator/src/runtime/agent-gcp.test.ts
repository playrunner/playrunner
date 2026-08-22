import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentExecutionRequest } from './contracts';
import {
  agentJobMatchesSettings,
  createAgentCloudRunJobBody,
  createAgentCloudRunRunBody,
  ensureAgentControlPubSubRole,
  GcpAgentExecutionBackend,
  mintAgentControlAccessToken,
  refreshGcpAccessTokenForAgent,
  resolveHostedAgentDurationMinutes,
  selectMatchingAgentExecution,
  waitForRunnerReadyOrExecutionFailure,
  withAgentControlPubSubRole,
} from './agent-gcp';
import { createDefaultAgentExecutionRegistry } from './index';

const PROTOCOL_TOKEN = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function request(
  overrides: {
    config?: Record<string, unknown>;
    reqBody?: Record<string, unknown>;
  } = {},
): AgentExecutionRequest {
  return {
    agent: { config: {}, nodeId: 'codex-agent', nodeType: 'codex-cli' },
    changeContext: undefined,
    config: overrides.config || { cpu: 4, memory: 8 },
    envKeys: [],
    globalEnvVars: {},
    nodeId: 'agent-container',
    nodeOutputs: {},
    publishEvent: async () => {},
    publishLog: async () => {},
    registerActiveProcess: () => {},
    reqBody: {
      cloudProvider: 'GCP',
      eventTransport: {
        projectId: 'test-project',
        topicName: 'workflow-events',
        type: 'gcp_pubsub',
      },
      gcpProject: 'test-project',
      settings: {
        gcp: {
          accessToken: 'gcp-token',
          cloudRunLocation: 'australia-southeast1',
        },
      },
      ...(overrides.reqBody || {}),
    },
    runtime: {
      cloudProvider: 'GCP',
      editorApiUrl: 'https://editor.test',
      executionAuthToken: 'execution-auth',
      nodeId: 'agent-container',
      testId: 'execution-1',
      workflowId: 'workflow-1',
    },
    validators: [
      { config: {}, nodeId: 'test-validator', nodeType: 'validator' },
    ],
  };
}

test('keeps payloads and credentials out of the static Agent job template', () => {
  const settings = {
    cpu: 4,
    imageUri:
      'australia-southeast1-docker.pkg.dev/test-project/agent-runner/playrunner-agent-runner:latest',
    memory: 8,
    serviceAccount:
      'playrunner-agent-runner@test-project.iam.gserviceaccount.com',
  };
  const body = createAgentCloudRunJobBody(settings);
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /github-secret|openai-secret|execution-auth/);
  const executionTemplate = body.template as {
    parallelism: number;
    taskCount: number;
    template: Record<string, unknown>;
  };
  const task = executionTemplate.template;
  assert.equal(executionTemplate.parallelism, 1);
  assert.equal(executionTemplate.taskCount, 1);
  assert.equal(
    task.serviceAccount,
    'playrunner-agent-runner@test-project.iam.gserviceaccount.com',
  );
  const container = (task.containers as Array<Record<string, unknown>>)[0];
  assert.equal(container.env, undefined);
  assert.equal(container.args, undefined);
  assert.equal(container.command, undefined);
  assert.equal(task.maxRetries, 0);
  assert.equal(agentJobMatchesSettings(body, settings), true);
  assert.equal(
    agentJobMatchesSettings(
      {
        ...body,
        template: {
          ...executionTemplate,
          template: {
            ...task,
            serviceAccount: '123-compute@developer.gserviceaccount.com',
          },
        },
      },
      settings,
    ),
    false,
  );
  assert.equal(
    agentJobMatchesSettings(
      {
        ...body,
        template: {
          ...executionTemplate,
          template: {
            ...task,
            containers: [
              container,
              { image: 'attacker.example/sidecar', name: 'sidecar' },
            ],
          },
        },
      },
      settings,
    ),
    false,
  );
  assert.equal(
    agentJobMatchesSettings(
      {
        ...body,
        template: { ...executionTemplate, parallelism: 2, taskCount: 2 },
      },
      settings,
    ),
    false,
  );
});

test('puts only the bounded bootstrap in Cloud Run overrides, never the Agent payload or argv', () => {
  const body = createAgentCloudRunRunBody(
    {
      executionId: 'execution-1',
      gcpAccessToken: 'scoped-agent-control-token',
      nodeId: 'agent-container',
      runnerControl: {
        controlSubscriptionName: 'agent-control',
        projectId: 'test-project',
        protocolToken: PROTOCOL_TOKEN,
        topicName: 'workflow-events',
        type: 'gcp_pubsub',
      },
    },
    'job-etag-1',
  );
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(
    serialized,
    /github-secret|openai-secret|execution-auth|agentMemoryByNodeId|broad-connected-user-oauth-token/,
  );
  assert.equal(body.etag, 'job-etag-1');
  const overrides = body.overrides as {
    containerOverrides: Array<Record<string, unknown>>;
  };
  assert.equal(overrides.containerOverrides.length, 1);
  const container = overrides.containerOverrides[0];
  assert.equal(container.args, undefined);
  assert.equal(container.command, undefined);
  const env = container.env as Array<{ name: string; value: string }>;
  assert.equal(env.length, 1);
  assert.equal(env[0].name, 'PLAYRUNNER_AGENT_BOOTSTRAP');
  assert.deepEqual(Object.keys(JSON.parse(env[0].value)).sort(), [
    'executionId',
    'gcpAccessToken',
    'nodeId',
    'runnerControl',
  ]);
});

test('limits hosted execution duration to the short-lived control-token window', () => {
  assert.equal(resolveHostedAgentDurationMinutes(undefined), 30);
  assert.equal(resolveHostedAgentDurationMinutes(45), 45);
  assert.throws(
    () => resolveHostedAgentDurationMinutes(46),
    /must be an integer from 1 to 45/,
  );
});

test('grants the control identity exactly one role on each Pub/Sub resource', () => {
  assert.deepEqual(
    withAgentControlPubSubRole(
      {
        bindings: [
          {
            members: [
              'serviceAccount:playrunner-agent-control@test-project.iam.gserviceaccount.com',
              'user:operator@example.com',
            ],
            role: 'roles/pubsub.editor',
          },
        ],
        etag: 'etag-1',
        version: 3,
      },
      'playrunner-agent-control@test-project.iam.gserviceaccount.com',
      'roles/pubsub.publisher',
    ),
    {
      bindings: [
        {
          members: ['user:operator@example.com'],
          role: 'roles/pubsub.editor',
        },
        {
          members: [
            'serviceAccount:playrunner-agent-control@test-project.iam.gserviceaccount.com',
          ],
          role: 'roles/pubsub.publisher',
        },
      ],
      etag: 'etag-1',
      version: 3,
    },
  );
});

test('re-reads and preserves a concurrent topic IAM update after an etag conflict', async () => {
  let getCount = 0;
  let setCount = 0;
  const waits: number[] = [];
  const requestIam = async <T>(
    _resource: string,
    method: 'getIamPolicy' | 'setIamPolicy',
    _accessToken: string,
    body: Record<string, unknown>,
  ): Promise<T> => {
    if (method === 'getIamPolicy') {
      getCount += 1;
      return {
        bindings:
          getCount === 1
            ? []
            : [
                {
                  members: ['user:concurrent@example.com'],
                  role: 'roles/pubsub.viewer',
                },
              ],
        etag: `etag-${getCount}`,
        version: 3,
      } as T;
    }
    setCount += 1;
    if (setCount === 1) {
      throw new Error('Pub/Sub IAM API returned 409: ABORTED etag conflict');
    }
    const desired = (body.policy || {}) as Record<string, unknown>;
    return desired as T;
  };

  await ensureAgentControlPubSubRole(
    {
      accessToken: 'broad-server-side-token',
      controlServiceAccount:
        'playrunner-agent-control@test-project.iam.gserviceaccount.com',
      resourceName: 'projects/test-project/topics/workflow-events',
      role: 'roles/pubsub.publisher',
    },
    requestIam,
    async (milliseconds) => {
      waits.push(milliseconds);
    },
  );

  assert.equal(getCount, 2);
  assert.equal(setCount, 2);
  assert.deepEqual(waits, [25]);
});

test('mints a fresh Pub/Sub-only control token from the roleless orchestrator identity', async () => {
  const requested: Array<{ input: string; init?: RequestInit }> = [];
  const token = await mintAgentControlAccessToken(
    {
      controlServiceAccount:
        'playrunner-agent-control@test-project.iam.gserviceaccount.com',
      orchestratorRuntimeServiceAccount:
        'playrunner-orchestrator-runtime@test-project.iam.gserviceaccount.com',
    },
    {
      async getCredentials() {
        return {
          client_email:
            'playrunner-orchestrator-runtime@test-project.iam.gserviceaccount.com',
        };
      },
      async getClient() {
        return {
          async getRequestHeaders() {
            return new Headers({ Authorization: 'Bearer runtime-adc-token' });
          },
        };
      },
    } as never,
    (async (input, init) => {
      requested.push({ input: String(input), init });
      return new Response(
        JSON.stringify({
          accessToken: 'scoped-agent-control-token',
          expireTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
        { status: 200 },
      );
    }) as typeof fetch,
  );

  assert.equal(token, 'scoped-agent-control-token');
  assert.equal(requested.length, 1);
  assert.match(requested[0].input, /playrunner-agent-control%40test-project/);
  assert.equal(
    (requested[0].init?.headers as Record<string, string>).Authorization,
    'Bearer runtime-adc-token',
  );
  assert.deepEqual(JSON.parse(String(requested[0].init?.body)), {
    lifetime: '3600s',
    scope: ['https://www.googleapis.com/auth/pubsub'],
  });
});

test('refreshes a near-expiry connected-user token at Agent prepare without forwarding it', async () => {
  const requests: Array<{
    body: unknown;
    headers: HeadersInit | undefined;
    url: string;
  }> = [];
  const refreshed = await refreshGcpAccessTokenForAgent(
    {
      accessToken: 'broad-nearly-expired-user-token',
      clientId: 'oauth-client',
      clientSecret: 'oauth-secret',
      expiresAt: 1_000_000 + 30_000,
      refreshToken: 'oauth-refresh',
    },
    (async (input, init) => {
      requests.push({
        body: init?.body,
        headers: init?.headers,
        url: String(input),
      });
      return new Response(
        JSON.stringify({
          access_token: 'broad-fresh-server-side-token',
          expires_in: 3600,
        }),
        { status: 200 },
      );
    }) as typeof fetch,
    () => 1_000_000,
  );

  assert.equal(refreshed, 'broad-fresh-server-side-token');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://oauth2.googleapis.com/token');
  assert.equal(
    (requests[0].headers as Record<string, string>)['Content-Type'],
    'application/x-www-form-urlencoded',
  );
  assert.deepEqual(
    Object.fromEntries(new URLSearchParams(String(requests[0].body))),
    {
      client_id: 'oauth-client',
      client_secret: 'oauth-secret',
      grant_type: 'refresh_token',
      refresh_token: 'oauth-refresh',
    },
  );
  const executionBody = JSON.stringify(
    createAgentCloudRunRunBody({
      executionId: 'execution-after-upstream-delay',
      gcpAccessToken: 'scoped-agent-control-token',
      nodeId: 'agent-container',
      runnerControl: {
        controlSubscriptionName: 'control-subscription',
        projectId: 'test-project',
        protocolToken: PROTOCOL_TOKEN,
        topicName: 'workflow-events',
        type: 'gcp_pubsub',
      },
    }),
  );
  assert.doesNotMatch(
    executionBody,
    /broad-nearly-expired-user-token|broad-fresh-server-side-token|oauth-refresh|oauth-secret/,
  );
});

test('default registry selects the hosted GCP Agent backend', async () => {
  const registry = createDefaultAgentExecutionRegistry();
  const invalidGcpRequest = request({
    reqBody: { cloudProvider: 'GCP', gcpProject: '' },
  });

  await assert.rejects(
    () => registry.prepare(invalidGcpRequest),
    /gcpProject must be configured in GCP settings/,
  );
});

test('rejects Cloud Run CPU and memory pairs that GCP cannot schedule', async () => {
  const backend = new GcpAgentExecutionBackend();

  await assert.rejects(
    () => backend.prepare(request({ config: { cpu: 1, memory: 8 } })),
    /memory 8 GiB exceeds the 1 CPU Cloud Run limit of 4 GiB/,
  );
});

test('stops the Cloud Run readiness monitor as soon as the runner is ready', async () => {
  const originalFetch = globalThis.fetch;
  let executionPolls = 0;
  globalThis.fetch = async () => {
    executionPolls += 1;
    return new Response(
      JSON.stringify({
        conditions: [{ state: 'CONDITION_PENDING', type: 'Completed' }],
      }),
      { status: 200 },
    );
  };
  try {
    await waitForRunnerReadyOrExecutionFailure({
      accessToken: 'gcp-token',
      executionName:
        'projects/test-project/locations/australia-southeast1/jobs/agent/executions/run-1',
      onExecutionTerminal: () => {
        assert.fail('A pending execution must not be marked terminal.');
      },
      waitUntilRunnerReady: async () => {},
    });
    const pollsAtReady = executionPolls;
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(executionPolls, pollsAtReady);
    assert.ok(executionPolls <= 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reconciles an ambiguous run only to the execution with its unique bootstrap', () => {
  const expectedBootstrap = {
    executionId: 'execution-1',
    gcpAccessToken: 'gcp-token',
    nodeId: 'agent-container',
    runnerControl: {
      controlSubscriptionName: 'agent-control',
      projectId: 'test-project',
      protocolToken: PROTOCOL_TOKEN,
      topicName: 'workflow-events',
      type: 'gcp_pubsub' as const,
    },
  };
  const execution = (
    name: string,
    createTime: string,
    bootstrap: typeof expectedBootstrap,
  ) => ({
    createTime,
    name,
    parallelism: 1,
    taskCount: 1,
    template: {
      containers: [
        {
          env: [
            {
              name: 'PLAYRUNNER_AGENT_BOOTSTRAP',
              value: JSON.stringify(bootstrap),
            },
          ],
          name: 'agent',
        },
      ],
    },
  });
  const correct = execution(
    'jobs/agent/executions/correct',
    '2026-08-21T00:00:01.000Z',
    expectedBootstrap,
  );
  const wrongNewest = execution(
    'jobs/agent/executions/wrong-newest',
    '2026-08-21T00:00:02.000Z',
    {
      ...expectedBootstrap,
      executionId: 'execution-2',
      runnerControl: {
        ...expectedBootstrap.runnerControl,
        protocolToken: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      },
    },
  );

  assert.equal(
    selectMatchingAgentExecution(
      [wrongNewest, correct],
      expectedBootstrap,
      Date.parse('2026-08-21T00:00:00.000Z'),
    )?.name,
    correct.name,
  );
});
