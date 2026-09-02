import type {
  GcpExecutionEvents,
  GcpRuntimeState,
  LogTransport,
  WorkflowExecutionBackend,
  WorkflowExecutionRequest,
  WorkflowExecutionResult,
} from './contracts';
import { GoogleAuth } from 'google-auth-library';
import {
  ensureOrchestratorService,
  normalizeGcpEditorApiOrigin,
} from './cloudrun';
import { ensureBucket, refreshGcpAccessTokenIfNeeded } from './gcs';
import type { GcpPubSubEventStreamManager } from './gcp-pubsub-events';
import {
  cancelPrewarmedGcpPlaywrightRunners,
  prewarmGcpPlaywrightRunners,
  type PrewarmedGcpPlaywrightRunner,
} from './playwright-prewarm';
import { createRunnerProtocolToken } from './runner-protocol';

const ORCHESTRATOR_HEALTH_MAX_ATTEMPTS = 8;
const ORCHESTRATOR_RETRY_BASE_DELAY_MS = 1000;
const ORCHESTRATOR_RETRY_MAX_DELAY_MS = 10000;
const MAX_GOOGLE_ID_TOKEN_LENGTH = 16 * 1024;

type GoogleIdentityAuth = Pick<
  GoogleAuth,
  'getCredentials' | 'getIdTokenClient'
>;

export class AmbiguousOrchestratorInvocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AmbiguousOrchestratorInvocationError';
  }
}

export function isAmbiguousOrchestratorInvocationError(
  error: unknown,
): boolean {
  return error instanceof AmbiguousOrchestratorInvocationError;
}

function boundedInvocationErrorMessage(error: unknown): string {
  const message =
    error instanceof Error ? error.message : 'Unknown orchestrator error';
  return (
    message.trim().replace(/\s+/g, ' ').slice(0, 500) ||
    'Unknown orchestrator error'
  );
}

export function gcpStartFailurePolicy(error: unknown): {
  cleanupResources: boolean;
  eventType: 'log' | 'workflow_failed';
} {
  const invocationOutcomeUnknown =
    isAmbiguousOrchestratorInvocationError(error);
  return {
    cleanupResources: !invocationOutcomeUnknown,
    eventType: invocationOutcomeUnknown ? 'log' : 'workflow_failed',
  };
}

export function gcpStartFailureResult(
  error: unknown,
  testId: string,
  target = 'Cloud Run Service',
  execution = 'service-invocation',
): WorkflowExecutionResult {
  if (isAmbiguousOrchestratorInvocationError(error)) {
    const invocationLabel =
      target === 'Cloud Run Service' ? 'Cloud Run' : target;
    return {
      body: {
        execution,
        invocationOutcome: 'unknown',
        message: `The ${invocationLabel} invocation response was lost. The workflow may already be running; poll this execution for updates. It will not be retried automatically.`,
        testId,
      },
      status: 202,
    };
  }

  const message = boundedInvocationErrorMessage(error);
  return {
    body: {
      error: `Failed to trigger ${target}: ${message}`,
      testId,
    },
    status: 500,
  };
}

export type GcpOrchestratorLaunchRequest = {
  accessToken: string;
  cloudRunLocation: string;
  projectId: string;
  requestBody: Record<string, any>;
  testId: string;
  workflowId?: string;
};

export type GcpOrchestratorLauncher = {
  execution: string;
  launch(args: GcpOrchestratorLaunchRequest): Promise<{
    execution: string;
    logMessage: string;
    message: string;
  }>;
  target: string;
};

export function missingRunnerSettings(
  gcp: Record<string, any>,
  usesCustomOrchestratorLauncher = false,
): string[] {
  const missing: string[] = [];

  if (!gcp.cloudRunLocation) {
    missing.push('Cloud Run region');
  }

  if (!usesCustomOrchestratorLauncher && !gcp.orchestratorServiceName) {
    missing.push('Orchestrator service name');
  }

  if (
    !usesCustomOrchestratorLauncher &&
    (gcp.orchestratorMinInstanceCount === undefined ||
      gcp.orchestratorMinInstanceCount === null ||
      gcp.orchestratorMinInstanceCount === '')
  ) {
    missing.push('Orchestrator minimum instance count');
  }

  if (
    !usesCustomOrchestratorLauncher &&
    (gcp.orchestratorMaxInstanceCount === undefined ||
      gcp.orchestratorMaxInstanceCount === null ||
      gcp.orchestratorMaxInstanceCount === '')
  ) {
    missing.push('Orchestrator maximum instance count');
  }

  if (
    !usesCustomOrchestratorLauncher &&
    (gcp.orchestratorCpuIdle === undefined ||
      gcp.orchestratorCpuIdle === null ||
      gcp.orchestratorCpuIdle === '')
  ) {
    missing.push('Orchestrator CPU idle policy');
  }

  if (!usesCustomOrchestratorLauncher && !gcp.orchestratorImageUriTemplate) {
    missing.push('Orchestrator image URI template');
  }

  if (!gcp.playwrightImageUriTemplate) {
    missing.push('Playwright image URI template');
  }

  return missing;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelayMs(attemptIndex: number): number {
  return Math.min(
    ORCHESTRATOR_RETRY_BASE_DELAY_MS * 2 ** attemptIndex,
    ORCHESTRATOR_RETRY_MAX_DELAY_MS,
  );
}

async function readResponseDetails(response: Response): Promise<string> {
  const details = await response.text().catch(() => '');
  const normalizedDetails = details.trim().replace(/\s+/g, ' ');
  const renderedDetails = normalizedDetails
    ? `: ${normalizedDetails.slice(0, 500)}`
    : '';

  return `${response.status} ${response.statusText}${renderedDetails}`;
}

function decodeIdentityTokenPayload(token: string): Record<string, unknown> {
  if (token.length > MAX_GOOGLE_ID_TOKEN_LENGTH) {
    throw new Error('Google identity token exceeded the allowed size.');
  }
  const segments = token.split('.');
  if (
    segments.length !== 3 ||
    segments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))
  ) {
    throw new Error('Google identity provider returned a malformed ID token.');
  }
  try {
    const value = JSON.parse(
      Buffer.from(segments[1], 'base64url').toString('utf8'),
    );
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('payload');
    }
    return value as Record<string, unknown>;
  } catch {
    throw new Error('Google identity provider returned a malformed ID token.');
  }
}

export async function createGcpOrchestratorIdentityHeaders(
  {
    audience,
    callerServiceAccountEmail,
    callerServiceAccountSubject,
  }: {
    audience: string;
    callerServiceAccountEmail: string;
    callerServiceAccountSubject: string;
  },
  googleAuth: GoogleIdentityAuth = new GoogleAuth(),
): Promise<Record<string, string>> {
  const expectedEmail = callerServiceAccountEmail.trim().toLowerCase();
  const expectedSubject = callerServiceAccountSubject.trim();
  if (!expectedEmail || !expectedSubject) {
    throw new Error(
      'The server-owned GCP orchestrator caller identity is not configured.',
    );
  }

  const credentials = await googleAuth.getCredentials();
  if (credentials.client_email?.trim().toLowerCase() !== expectedEmail) {
    throw new Error(
      'Application Default Credentials do not match the configured GCP orchestrator caller service account.',
    );
  }
  const idTokenClient = await googleAuth.getIdTokenClient(audience);
  const requestHeaders = await idTokenClient.getRequestHeaders(audience);
  const authorization = requestHeaders.get('authorization')?.trim() || '';
  const match = /^Bearer (\S+)$/.exec(authorization);
  if (!match) {
    throw new Error(
      'Application Default Credentials did not provide a Google identity token.',
    );
  }
  const payload = decodeIdentityTokenPayload(match[1]);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    payload.aud !== audience ||
    (payload.iss !== 'https://accounts.google.com' &&
      payload.iss !== 'accounts.google.com') ||
    typeof payload.email !== 'string' ||
    payload.email.trim().toLowerCase() !== expectedEmail ||
    payload.email_verified !== true ||
    payload.sub !== expectedSubject ||
    typeof payload.exp !== 'number' ||
    payload.exp <= nowSeconds
  ) {
    throw new Error(
      'Application Default Credentials returned an identity token for an unexpected caller or audience.',
    );
  }
  return { Authorization: authorization };
}

async function publishGcpWorkflowLog(
  logTransport: LogTransport,
  params: {
    level?: 'debug' | 'error' | 'info' | 'warning' | 'warn';
    message: string;
    testId: string;
    type?: string;
    workflowId?: string;
  },
) {
  try {
    await logTransport.publish(
      JSON.stringify({
        cloudProvider: 'GCP',
        executionId: params.testId,
        level: params.level || 'info',
        message: params.message,
        testId: params.testId,
        timestamp: new Date().toISOString(),
        type: params.type || 'log',
        workflowId: params.workflowId,
      }),
    );
  } catch {
    // Ignore best-effort log transport failures.
  }
}

export async function waitForOrchestratorServiceReady(
  serviceUri: string,
  identityHeaders: Readonly<Record<string, string>>,
  logTransport: LogTransport,
  testId: string,
  workflowId?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await publishGcpWorkflowLog(logTransport, {
    message: 'Waiting for Cloud Run orchestrator to become ready.',
    testId,
    workflowId,
  });

  let lastError = 'No health check response.';

  for (let attempt = 0; attempt < ORCHESTRATOR_HEALTH_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetchImpl(`${serviceUri}/health`, {
        headers: identityHeaders,
        method: 'GET',
      });
      if (response.ok) {
        await publishGcpWorkflowLog(logTransport, {
          message: 'Cloud Run orchestrator is ready.',
          testId,
          workflowId,
        });
        return;
      }

      lastError = await readResponseDetails(response);
    } catch (error: any) {
      lastError = error?.message || 'Health check request failed.';
    }

    if (attempt === ORCHESTRATOR_HEALTH_MAX_ATTEMPTS - 1) {
      break;
    }

    const delayMs = getRetryDelayMs(attempt);
    await publishGcpWorkflowLog(logTransport, {
      message: `Cloud Run orchestrator is not ready yet (${lastError}). Retrying in ${Math.round(delayMs / 1000)}s.`,
      testId,
      workflowId,
    });
    await sleep(delayMs);
  }

  throw new Error(
    `Cloud Run orchestrator did not become ready after ${ORCHESTRATOR_HEALTH_MAX_ATTEMPTS} checks. Last health check: ${lastError}`,
  );
}

export async function invokeOrchestratorService(
  serviceUri: string,
  requestBody: Record<string, any>,
  identityHeaders: Readonly<Record<string, string>>,
  _logTransport: LogTransport,
  _testId: string,
  _workflowId?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  let response: Response;

  try {
    response = await fetchImpl(`${serviceUri}/execute`, {
      method: 'POST',
      headers: {
        ...identityHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
  } catch (error: any) {
    throw new AmbiguousOrchestratorInvocationError(
      `Failed to execute orchestrator service: ${error?.message || 'Request failed'}`,
    );
  }

  if (response.ok) {
    return;
  }

  const details = await readResponseDetails(response);
  if (
    response.status === 408 ||
    response.status === 429 ||
    (response.status >= 500 && response.status <= 599)
  ) {
    throw new AmbiguousOrchestratorInvocationError(
      `Cloud Run orchestrator returned ${details}. The invocation outcome is unknown and will not be retried automatically.`,
    );
  }

  throw new Error(`Failed to execute orchestrator service: ${details}`);
}

export class GcpWorkflowExecutionBackend implements WorkflowExecutionBackend {
  private readonly executionEvents: GcpExecutionEvents;
  private readonly logTransport: LogTransport;
  private readonly pubSubEventStreamManager: GcpPubSubEventStreamManager;
  private readonly state: GcpRuntimeState;
  private readonly orchestratorLauncher?: GcpOrchestratorLauncher;

  constructor({
    executionEvents,
    logTransport,
    pubSubEventStreamManager,
    state,
    orchestratorLauncher,
  }: {
    executionEvents: GcpExecutionEvents;
    logTransport: LogTransport;
    pubSubEventStreamManager: GcpPubSubEventStreamManager;
    state: GcpRuntimeState;
    orchestratorLauncher?: GcpOrchestratorLauncher;
  }) {
    this.executionEvents = executionEvents;
    this.logTransport = logTransport;
    this.pubSubEventStreamManager = pubSubEventStreamManager;
    this.state = state;
    this.orchestratorLauncher = orchestratorLauncher;
  }

  supports(cloudProvider: string): boolean {
    return cloudProvider === 'GCP';
  }

  async execute(
    request: WorkflowExecutionRequest,
  ): Promise<WorkflowExecutionResult> {
    const { body, req, testId } = request;
    const { workflowId, settings } = body;
    const gcp = settings?.gcp;
    const userId = req.authUser?.providerUserId;

    if (!gcp?.accessToken) {
      return {
        body: {
          error:
            'GCP credentials required. Connect GCP from the GCP Runner menu or Integrations before running.',
        },
        status: 400,
      };
    }

    if (!gcp.selectedProject) {
      return {
        body: {
          error:
            'GCP project required. Select a project in the Connect to GCP dialog before running.',
        },
        status: 400,
      };
    }

    const missingSettings = missingRunnerSettings(
      gcp,
      Boolean(this.orchestratorLauncher),
    );
    if (missingSettings.length > 0) {
      return {
        body: {
          error: `GCP runner settings required. Open the Connect to GCP dialog and complete: ${missingSettings.join(', ')}.`,
        },
        status: 400,
      };
    }

    if (!userId) {
      return {
        body: { error: 'Unauthorized' },
        status: 401,
      };
    }

    const editorApiUrl = normalizeGcpEditorApiOrigin(
      process.env.PLAYRUNNER_PUBLIC_API_URL,
    );

    this.state.gcpCredentials[testId] = {
      accessToken: gcp.accessToken,
      refreshToken: gcp.refreshToken,
      clientId: gcp.clientId,
      clientSecret: gcp.clientSecret,
      expiresAt: gcp.expiresAt,
      selectedProject: gcp.selectedProject,
    };

    const { executionToken } = await this.executionEvents.createExecution({
      cloudProvider: 'GCP',
      executionId: testId,
      userId,
      workflowId,
    });

    body.executionAuthToken = executionToken;
    const eventAuthToken = createRunnerProtocolToken();
    body.eventAuthToken = eventAuthToken;

    try {
      await this.logTransport.publish(
        JSON.stringify({
          cloudProvider: 'GCP',
          executionId: testId,
          level: 'info',
          message: 'Workflow execution requested.',
          testId,
          timestamp: new Date().toISOString(),
          type: 'workflow_started',
          workflowId,
        }),
      );
    } catch {
      // Ignore best-effort log transport failures.
    }

    let bucketName = '';
    let eventTransport:
      | {
          projectId: string;
          subscriptionName: string;
          topicName: string;
          type: 'gcp_pubsub';
        }
      | undefined;
    let refreshedToken = gcp.accessToken;
    let gcpSetupStep = 'refresh GCP access token';

    try {
      refreshedToken =
        (await refreshGcpAccessTokenIfNeeded(gcp)) || gcp.accessToken;
      if (refreshedToken) {
        this.state.gcpCredentials[testId].accessToken = refreshedToken;
        body.settings.gcp.accessToken = refreshedToken;
      }

      gcpSetupStep = 'configure GCP Pub/Sub workflow event transport';
      eventTransport =
        await this.pubSubEventStreamManager.ensureGcpPubSubEventStream({
          creds: this.state.gcpCredentials[testId],
          emulatorHost: null,
          eventAuthToken,
          executionId: testId,
          projectId: gcp.selectedProject,
        });
      body.eventTransport = eventTransport;

      if (workflowId) {
        gcpSetupStep = 'create GCS bucket';
        const result = await ensureBucket(
          workflowId,
          refreshedToken,
          gcp.selectedProject,
        );
        if (!result) {
          this.pubSubEventStreamManager.stopGcpPubSubEventStream(testId);
          try {
            await this.logTransport.publish(
              JSON.stringify({
                executionId: testId,
                level: 'error',
                message: 'Failed to create GCS bucket.',
                testId,
                timestamp: new Date().toISOString(),
                type: 'workflow_failed',
                workflowId,
              }),
            );
          } catch {
            // Ignore best-effort log transport failures.
          }

          return {
            body: { error: 'Failed to create GCS bucket.', testId },
            status: 500,
          };
        }

        bucketName = result.bucketName;
        this.state.testBucketNames[testId] = bucketName;
        body.bucketName = bucketName;
      }
    } catch (err: any) {
      this.pubSubEventStreamManager.stopGcpPubSubEventStream(testId);
      try {
        await this.logTransport.publish(
          JSON.stringify({
            executionId: testId,
            level: 'error',
            message: `Failed to ${gcpSetupStep}: ${err.message}`,
            testId,
            timestamp: new Date().toISOString(),
            type: 'workflow_failed',
            workflowId,
          }),
        );
      } catch {
        // Ignore best-effort log transport failures.
      }

      return {
        body: { error: `Failed to ${gcpSetupStep}: ${err.message}`, testId },
        status: 500,
      };
    }

    let prewarmPromise:
      | Promise<Record<string, PrewarmedGcpPlaywrightRunner>>
      | undefined;
    let prewarmedPlaywrightRunners: Record<
      string,
      PrewarmedGcpPlaywrightRunner
    > = {};

    try {
      if (eventTransport) {
        prewarmPromise = prewarmGcpPlaywrightRunners({
          accessToken: refreshedToken,
          body,
          bucketName,
          editorApiUrl,
          eventTransport,
          executionToken,
          logTransport: this.logTransport,
          projectId: gcp.selectedProject,
          testId,
          workflowId,
        });
      }

      if (prewarmPromise) {
        prewarmedPlaywrightRunners = await prewarmPromise;
      }

      const orchestratorRequestBody = {
        ...body,
        editorApiUrl,
        eventTransport,
        gcpProject: gcp.selectedProject,
        bucketName,
        executionAuthToken: executionToken,
        prewarmedPlaywrightRunners,
        testId,
      };
      let launchResult: {
        execution: string;
        logMessage: string;
        message: string;
      };
      if (this.orchestratorLauncher) {
        launchResult = await this.orchestratorLauncher.launch({
          accessToken: refreshedToken,
          cloudRunLocation: gcp.cloudRunLocation,
          projectId: gcp.selectedProject,
          requestBody: orchestratorRequestBody,
          testId,
          workflowId,
        });
      } else {
        const serviceUri = await ensureOrchestratorService(
          gcp.selectedProject,
          refreshedToken,
          {
            cloudRunLocation: gcp.cloudRunLocation,
            editorApiUrl,
            orchestratorCallerServiceAccountEmail:
              process.env
                .PLAYRUNNER_GCP_ORCHESTRATOR_CALLER_SERVICE_ACCOUNT_EMAIL,
            orchestratorCallerServiceAccountSubject:
              process.env
                .PLAYRUNNER_GCP_ORCHESTRATOR_CALLER_SERVICE_ACCOUNT_SUBJECT,
            orchestratorCpuIdle: gcp.orchestratorCpuIdle,
            orchestratorImageUriTemplate: gcp.orchestratorImageUriTemplate,
            orchestratorMaxInstanceCount: gcp.orchestratorMaxInstanceCount,
            orchestratorMinInstanceCount: gcp.orchestratorMinInstanceCount,
            orchestratorRuntimeServiceAccountEmail: `playrunner-orchestrator-runtime@${gcp.selectedProject}.iam.gserviceaccount.com`,
            orchestratorServiceName: gcp.orchestratorServiceName,
          },
        );
        const identityHeaders = await createGcpOrchestratorIdentityHeaders({
          audience: serviceUri,
          callerServiceAccountEmail:
            process.env
              .PLAYRUNNER_GCP_ORCHESTRATOR_CALLER_SERVICE_ACCOUNT_EMAIL || '',
          callerServiceAccountSubject:
            process.env
              .PLAYRUNNER_GCP_ORCHESTRATOR_CALLER_SERVICE_ACCOUNT_SUBJECT || '',
        });

        await waitForOrchestratorServiceReady(
          serviceUri,
          identityHeaders,
          this.logTransport,
          testId,
          workflowId,
        );
        await invokeOrchestratorService(
          serviceUri,
          orchestratorRequestBody,
          identityHeaders,
          this.logTransport,
          testId,
          workflowId,
        );
        launchResult = {
          execution: 'service-invocation',
          logMessage: 'Orchestrator Cloud Run Service triggered successfully.',
          message: `Workflow triggered on Cloud Run Service successfully, testId: ${testId}`,
        };
      }

      try {
        await this.logTransport.publish(
          JSON.stringify({
            executionId: testId,
            level: 'info',
            message: launchResult.logMessage,
            testId,
            timestamp: new Date().toISOString(),
            type: 'log',
            workflowId,
          }),
        );
      } catch (error) {
        console.error('Failed to persist workflow start event', error);
      }

      return {
        body: {
          message: launchResult.message,
          execution: launchResult.execution,
          testId,
        },
        status: 200,
      };
    } catch (err: any) {
      console.error('[workflows] GCP Run failed:', err);
      const invocationTarget =
        this.orchestratorLauncher?.target || 'Cloud Run Service';
      const invocationOutcomeUnknown =
        isAmbiguousOrchestratorInvocationError(err);
      const failurePolicy = gcpStartFailurePolicy(err);
      if (failurePolicy.cleanupResources) {
        this.pubSubEventStreamManager.stopGcpPubSubEventStream(testId);
        const runnersToCancel =
          Object.keys(prewarmedPlaywrightRunners).length > 0
            ? prewarmedPlaywrightRunners
            : prewarmPromise
              ? await prewarmPromise.catch(() => ({}))
              : {};

        if (Object.keys(runnersToCancel).length > 0) {
          await cancelPrewarmedGcpPlaywrightRunners({
            accessToken: refreshedToken,
            runners: runnersToCancel,
          });
        }
      }

      try {
        const failureDetails = boundedInvocationErrorMessage(err);
        await this.logTransport.publish(
          JSON.stringify({
            executionId: testId,
            level: invocationOutcomeUnknown ? 'warn' : 'error',
            message: invocationOutcomeUnknown
              ? `Cloud Run invocation outcome unknown: ${failureDetails}. No automatic retry was attempted; poll this execution for updates.`
              : `Failed to trigger ${invocationTarget}: ${failureDetails}`,
            testId,
            timestamp: new Date().toISOString(),
            type: failurePolicy.eventType,
            workflowId,
          }),
        );
      } catch {
        // Ignore best-effort log transport failures.
      }

      return gcpStartFailureResult(
        err,
        testId,
        invocationTarget,
        this.orchestratorLauncher?.execution,
      );
    }
  }
}
