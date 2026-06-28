import type {
  GcpExecutionEvents,
  GcpRuntimeState,
  LogTransport,
  WorkflowExecutionBackend,
  WorkflowExecutionRequest,
  WorkflowExecutionResult,
} from './contracts';
import { ensureOrchestratorService } from './cloudrun';
import { ensureBucket, refreshGcpAccessTokenIfNeeded } from './gcs';
import type { GcpPubSubEventStreamManager } from './gcp-pubsub-events';
import {
  cancelPrewarmedGcpPlaywrightRunners,
  prewarmGcpPlaywrightRunners,
  type PrewarmedGcpPlaywrightRunner,
} from './playwright-prewarm';

const ORCHESTRATOR_HEALTH_MAX_ATTEMPTS = 8;
const ORCHESTRATOR_INVOKE_MAX_ATTEMPTS = 3;
const ORCHESTRATOR_RETRY_BASE_DELAY_MS = 1000;
const ORCHESTRATOR_RETRY_MAX_DELAY_MS = 10000;
const ORCHESTRATOR_RETRYABLE_STATUS_CODES = new Set([
  408, 429, 500, 502, 503, 504,
]);

function missingRunnerSettings(gcp: Record<string, any>): string[] {
  const missing: string[] = [];

  if (!gcp.cloudRunLocation) {
    missing.push('Cloud Run region');
  }

  if (!gcp.orchestratorImageUriTemplate) {
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

async function waitForOrchestratorServiceReady(
  serviceUri: string,
  logTransport: LogTransport,
  testId: string,
  workflowId?: string,
): Promise<void> {
  await publishGcpWorkflowLog(logTransport, {
    message: 'Waiting for Cloud Run orchestrator to become ready.',
    testId,
    workflowId,
  });

  let lastError = 'No health check response.';

  for (let attempt = 0; attempt < ORCHESTRATOR_HEALTH_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`${serviceUri}/health`, { method: 'GET' });
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

async function invokeOrchestratorService(
  serviceUri: string,
  requestBody: Record<string, any>,
  logTransport: LogTransport,
  testId: string,
  workflowId?: string,
): Promise<void> {
  let lastError = 'No invocation response.';

  for (let attempt = 0; attempt < ORCHESTRATOR_INVOKE_MAX_ATTEMPTS; attempt++) {
    let response: Response;

    try {
      response = await fetch(`${serviceUri}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
    } catch (error: any) {
      throw new Error(
        `Failed to execute orchestrator service: ${error?.message || 'Request failed'}`,
      );
    }

    if (response.ok) {
      return;
    }

    lastError = await readResponseDetails(response);
    if (
      !ORCHESTRATOR_RETRYABLE_STATUS_CODES.has(response.status) ||
      attempt === ORCHESTRATOR_INVOKE_MAX_ATTEMPTS - 1
    ) {
      break;
    }

    const delayMs = getRetryDelayMs(attempt);
    await publishGcpWorkflowLog(logTransport, {
      message: `Cloud Run orchestrator invoke returned ${lastError}. Retrying in ${Math.round(delayMs / 1000)}s.`,
      testId,
      workflowId,
    });
    await sleep(delayMs);
  }

  throw new Error(`Failed to execute orchestrator service: ${lastError}`);
}

export class GcpWorkflowExecutionBackend implements WorkflowExecutionBackend {
  private readonly executionEvents: GcpExecutionEvents;
  private readonly logTransport: LogTransport;
  private readonly pubSubEventStreamManager: GcpPubSubEventStreamManager;
  private readonly state: GcpRuntimeState;

  constructor({
    executionEvents,
    logTransport,
    pubSubEventStreamManager,
    state,
  }: {
    executionEvents: GcpExecutionEvents;
    logTransport: LogTransport;
    pubSubEventStreamManager: GcpPubSubEventStreamManager;
    state: GcpRuntimeState;
  }) {
    this.executionEvents = executionEvents;
    this.logTransport = logTransport;
    this.pubSubEventStreamManager = pubSubEventStreamManager;
    this.state = state;
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
          error: 'GCP credentials required. Connect a GCP account in Settings.',
        },
        status: 400,
      };
    }

    if (!gcp.selectedProject) {
      return {
        body: {
          error:
            'GCP project required. Select a project in the UI before running.',
        },
        status: 400,
      };
    }

    const missingSettings = missingRunnerSettings(gcp);
    if (missingSettings.length > 0) {
      return {
        body: {
          error: `GCP runner settings required. Open Settings > Google Cloud and complete: ${missingSettings.join(', ')}.`,
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

    const editorApiUrl = `${req.protocol}://${req.get('host')}`;

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

      const serviceUri = await ensureOrchestratorService(
        gcp.selectedProject,
        refreshedToken,
        {
          cloudRunLocation: gcp.cloudRunLocation,
          orchestratorImageUriTemplate: gcp.orchestratorImageUriTemplate,
          orchestratorServiceName: gcp.orchestratorServiceName,
        },
      );

      await waitForOrchestratorServiceReady(
        serviceUri,
        this.logTransport,
        testId,
        workflowId,
      );

      if (prewarmPromise) {
        prewarmedPlaywrightRunners = await prewarmPromise;
      }

      await invokeOrchestratorService(
        serviceUri,
        {
          ...body,
          editorApiUrl,
          eventTransport,
          gcpProject: gcp.selectedProject,
          bucketName,
          executionAuthToken: executionToken,
          prewarmedPlaywrightRunners,
          testId,
        },
        this.logTransport,
        testId,
        workflowId,
      );

      try {
        await this.logTransport.publish(
          JSON.stringify({
            executionId: testId,
            level: 'info',
            message: 'Orchestrator Cloud Run Service triggered successfully.',
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
          message: `Workflow triggered on Cloud Run Service successfully, testId: ${testId}`,
          execution: 'service-invocation',
          testId,
        },
        status: 200,
      };
    } catch (err: any) {
      console.error('[workflows] GCP Run failed:', err);
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

      try {
        await this.logTransport.publish(
          JSON.stringify({
            executionId: testId,
            level: 'error',
            message: `Failed to trigger Cloud Run Service: ${err.message}`,
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
        body: {
          error: `Failed to trigger Cloud Run Service: ${err.message}`,
          testId,
        },
        status: 500,
      };
    }
  }
}
