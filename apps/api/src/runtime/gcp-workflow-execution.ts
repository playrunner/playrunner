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
const CALLBACK_TUNNEL_MONITOR_INITIAL_DELAY_MS = 5000;
const CALLBACK_TUNNEL_MONITOR_INTERVAL_MS = 10000;
const CALLBACK_TUNNEL_MONITOR_MAX_DURATION_MS = 6 * 60 * 60 * 1000;
const CALLBACK_TUNNEL_MONITOR_MAX_FAILURES = 2;
const CALLBACK_TUNNEL_REACHABILITY_GRACE_MS = 3 * 60 * 1000;
const ORCHESTRATOR_RETRYABLE_STATUS_CODES = new Set([
  408, 429, 500, 502, 503, 504,
]);
const callbackTunnelMonitorTimers = new Map<
  string,
  ReturnType<typeof setTimeout>
>();

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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCurrentTunnelCallbackUrl(editorApiUrl: string): boolean {
  const tunnelState = tunnelService.getState();
  return tunnelState.status === 'running' && tunnelState.url === editorApiUrl;
}

function buildTunnelCallbackFailureMessage(reason: string): string {
  return `Cloudflare tunnel callback URL is no longer reachable. Restart the tunnel and run the workflow again. Details: ${reason}`;
}

function isTunnelReachabilityFailureFatal(editorApiUrl: string): boolean {
  if (!isCurrentTunnelCallbackUrl(editorApiUrl)) {
    return false;
  }

  return (
    tunnelService.hasConfirmedReachability(editorApiUrl) ||
    !tunnelService.isWithinReachabilityGracePeriod(
      editorApiUrl,
      CALLBACK_TUNNEL_REACHABILITY_GRACE_MS,
    )
  );
}

async function assertTunnelCallbackReady(editorApiUrl: string): Promise<void> {
  if (!isCurrentTunnelCallbackUrl(editorApiUrl)) {
    return;
  }

  try {
    await tunnelService.assertReachable(editorApiUrl);
  } catch (error) {
    const message = buildTunnelCallbackFailureMessage(getErrorMessage(error));
    if (!isTunnelReachabilityFailureFatal(editorApiUrl)) {
      console.warn(
        `[workflows] GCP callback tunnel is not locally reachable yet; continuing while DNS propagates. ${message}`,
      );
      return;
    }
    tunnelService.markUnreachable(message, editorApiUrl);
    throw new Error(message);
  }
}

async function appendGcpWorkflowFailure(
  testId: string,
  workflowId: string | undefined,
  message: string,
): Promise<void> {
  const status = await executionEvents.getExecutionStatus(testId);
  if (status !== 'running') {
    return;
  }

  await executionEvents.appendEvent(testId, {
    cloudProvider: 'GCP',
    executionId: testId,
    level: 'error',
    message,
    testId,
    timestamp: new Date().toISOString(),
    type: 'workflow_failed',
    workflowId,
  });
}

function startTunnelCallbackMonitor(params: {
  editorApiUrl: string;
  testId: string;
  workflowId?: string;
}): void {
  if (!isCurrentTunnelCallbackUrl(params.editorApiUrl)) {
    return;
  }

  const existingTimer = callbackTunnelMonitorTimers.get(params.testId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const startedAt = Date.now();
  let failureCount = 0;

  const stop = () => {
    const timer = callbackTunnelMonitorTimers.get(params.testId);
    if (timer) {
      clearTimeout(timer);
    }
    callbackTunnelMonitorTimers.delete(params.testId);
  };

  const failExecution = async (message: string, markTunnel = true) => {
    stop();
    if (markTunnel) {
      tunnelService.markUnreachable(message, params.editorApiUrl);
    }
    await appendGcpWorkflowFailure(params.testId, params.workflowId, message);
  };

  const schedule = (delayMs: number) => {
    const timer = setTimeout(() => {
      void check().catch((error) => {
        console.error(
          `[workflows] GCP callback tunnel monitor failed for ${params.testId}:`,
          error,
        );
        schedule(CALLBACK_TUNNEL_MONITOR_INTERVAL_MS);
      });
    }, delayMs);
    callbackTunnelMonitorTimers.set(params.testId, timer);
  };

  const check = async (): Promise<void> => {
    const status = await executionEvents.getExecutionStatus(params.testId);
    if (
      status !== 'running' ||
      Date.now() - startedAt > CALLBACK_TUNNEL_MONITOR_MAX_DURATION_MS
    ) {
      stop();
      return;
    }

    const tunnelState = tunnelService.getState();
    if (tunnelState.status !== 'running' || !tunnelState.url) {
      await failExecution(
        'Cloudflare tunnel stopped before the cloud workflow finished. Restart the tunnel and run the workflow again.',
      );
      return;
    }

    if (tunnelState.url !== params.editorApiUrl) {
      await failExecution(
        'Cloudflare tunnel URL changed before the cloud workflow finished. Restart the workflow so cloud runners use the current tunnel URL.',
        false,
      );
      return;
    }

    try {
      await tunnelService.assertReachable(params.editorApiUrl);
      failureCount = 0;
      schedule(CALLBACK_TUNNEL_MONITOR_INTERVAL_MS);
    } catch (error) {
      const message = buildTunnelCallbackFailureMessage(getErrorMessage(error));

      if (!isTunnelReachabilityFailureFatal(params.editorApiUrl)) {
        console.warn(
          `[workflows] GCP callback tunnel probe deferred for ${params.testId}: ${message}`,
        );
        schedule(CALLBACK_TUNNEL_MONITOR_INTERVAL_MS);
        return;
      }

      failureCount += 1;

      if (failureCount >= CALLBACK_TUNNEL_MONITOR_MAX_FAILURES) {
        await failExecution(message);
        return;
      }

      console.warn(
        `[workflows] GCP callback tunnel probe failed for ${params.testId}: ${message}`,
      );
      schedule(CALLBACK_TUNNEL_MONITOR_INTERVAL_MS);
    }
  };

  schedule(CALLBACK_TUNNEL_MONITOR_INITIAL_DELAY_MS);
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

    try {
      await assertTunnelCallbackReady(editorApiUrl);
    } catch (error) {
      return {
        body: {
          code: 'TUNNEL_REQUIRED',
          error: getErrorMessage(error),
        },
        status: 409,
      };
    }

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

      await assertTunnelCallbackReady(editorApiUrl);

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

      startTunnelCallbackMonitor({
        editorApiUrl,
        testId,
        workflowId,
      });

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
