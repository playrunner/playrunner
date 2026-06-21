import type {
  LogTransport,
  WorkflowExecutionBackend,
  WorkflowExecutionRequest,
  WorkflowExecutionResult,
} from './contracts';
import { EDITOR_API_PUBLIC_URL } from '../config';
import { ensureOrchestratorService } from '../services/cloudrun';
import { executionEvents } from '../services/execution-events';
import {
  ensureBucket,
  getStorage,
  refreshGcpAccessTokenIfNeeded,
} from '../services/gcs';
import { state } from '../state';

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

    if (!userId) {
      return {
        body: { error: 'Unauthorized' },
        status: 401,
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
      const storage = getStorage(refreshedToken, gcp.selectedProject);
      const bucket = storage.bucket(bucketName);
      const file = bucket.file(`executions/${testId}/payload.json`);
      await file.save(JSON.stringify(body), {
        contentType: 'application/json',
      });

      const workflowPayloadUri = `gs://${bucketName}/executions/${testId}/payload.json`;
      console.log(
        `[workflows] Uploaded workflow payload to ${workflowPayloadUri}`,
      );

      const editorApiUrl =
        EDITOR_API_PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
      const serviceUri = await ensureOrchestratorService(
        gcp.selectedProject,
        refreshedToken,
      );

      const executeResponse = await fetch(`${serviceUri}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          editorApiUrl,
          gcpProject: gcp.selectedProject,
          bucketName,
          executionAuthToken: executionToken,
          testId,
          workflowPayloadUri,
        }),
      });

      if (!executeResponse.ok) {
        throw new Error(
          `Failed to execute orchestrator service: ${executeResponse.statusText}`,
        );
      }

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
