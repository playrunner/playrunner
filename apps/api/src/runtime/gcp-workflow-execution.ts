import type {
  LogTransport,
  WorkflowExecutionBackend,
  WorkflowExecutionRequest,
  WorkflowExecutionResult,
} from './contracts';
import type { Request } from 'express';
import { EDITOR_API_PUBLIC_URL } from '../config';
import { ensureOrchestratorService } from '../services/cloudrun';
import { executionEvents } from '../services/execution-events';
import { ensureBucket, refreshGcpAccessTokenIfNeeded } from '../services/gcs';
import { tunnelService } from '../services/tunnel';
import { state } from '../state';

const ORCHESTRATOR_HEALTH_MAX_ATTEMPTS = 8;
const ORCHESTRATOR_INVOKE_MAX_ATTEMPTS = 3;
const ORCHESTRATOR_RETRY_BASE_DELAY_MS = 1000;
const ORCHESTRATOR_RETRY_MAX_DELAY_MS = 10000;
const ORCHESTRATOR_RETRYABLE_STATUS_CODES = new Set([
  408, 429, 500, 502, 503, 504,
]);

function isLocalHost(host: string | undefined): boolean {
  if (!host) {
    return false;
  }
  const hostname = host
    .split(':')[0]
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === 'host.docker.internal'
  );
}

// Cloud runners call back to this URL. When the API only has a local host and
// no public/tunnel URL is available, the runners cannot reach it, so we signal
// the editor to start a tunnel instead of failing mid-execution.
function resolveEditorApiUrl(
  req: Request,
): { editorApiUrl: string } | { tunnelRequired: true } {
  if (EDITOR_API_PUBLIC_URL) {
    return { editorApiUrl: EDITOR_API_PUBLIC_URL };
  }
  if (tunnelService.isActive()) {
    return { editorApiUrl: tunnelService.getState().url };
  }
  if (isLocalHost(req.get('host'))) {
    return { tunnelRequired: true };
  }
  return { editorApiUrl: `${req.protocol}://${req.get('host')}` };
}

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
  constructor(private readonly logTransport: LogTransport) {}

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

    const editorApiResolution = resolveEditorApiUrl(req);
    if ('tunnelRequired' in editorApiResolution) {
      return {
        body: {
          code: 'TUNNEL_REQUIRED',
          error:
            'Cloud runners cannot reach this local Playrunner API. Start a tunnel to expose it, then run again.',
        },
        status: 409,
      };
    }
    const editorApiUrl = editorApiResolution.editorApiUrl;

    state.gcpCredentials[testId] = {
      accessToken: gcp.accessToken,
      refreshToken: gcp.refreshToken,
      clientId: gcp.clientId,
      clientSecret: gcp.clientSecret,
      expiresAt: gcp.expiresAt,
      selectedProject: gcp.selectedProject,
    };

    const { executionToken } = await executionEvents.createExecution({
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
    let refreshedToken = gcp.accessToken;

    try {
      refreshedToken =
        (await refreshGcpAccessTokenIfNeeded(gcp)) || gcp.accessToken;
      if (refreshedToken) {
        state.gcpCredentials[testId].accessToken = refreshedToken;
      }

      if (workflowId) {
        const result = await ensureBucket(
          workflowId,
          refreshedToken,
          gcp.selectedProject,
        );
        if (!result) {
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
        state.testBucketNames[testId] = bucketName;
        body.bucketName = bucketName;
      }
    } catch (err: any) {
      try {
        await this.logTransport.publish(
          JSON.stringify({
            executionId: testId,
            level: 'error',
            message: `Failed to create GCS bucket: ${err.message}`,
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
        body: { error: `Failed to create GCS bucket: ${err.message}`, testId },
        status: 500,
      };
    }

    try {
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

      await invokeOrchestratorService(
        serviceUri,
        {
          ...body,
          editorApiUrl,
          gcpProject: gcp.selectedProject,
          bucketName,
          executionAuthToken: executionToken,
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
