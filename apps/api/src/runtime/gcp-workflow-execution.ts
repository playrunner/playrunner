import type { LogTransport, WorkflowExecutionBackend, WorkflowExecutionRequest, WorkflowExecutionResult } from './contracts';
import { ensureOrchestratorService } from '../services/cloudrun';
import { ensureBucket, getStorage, refreshGcpAccessTokenIfNeeded } from '../services/gcs';
import { ensureGcpPubSubSubscription } from '../services/gcp-pubsub';
import { state } from '../state';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set for GCP workflow execution.`);
  }
  return value;
}

export class GcpWorkflowExecutionBackend implements WorkflowExecutionBackend {
  constructor(private readonly logTransport: LogTransport) {}

  supports(cloudProvider: string): boolean {
    return cloudProvider === 'GCP';
  }

  async execute(request: WorkflowExecutionRequest): Promise<WorkflowExecutionResult> {
    const { body, req, testId } = request;
    const { workflowId, settings } = body;
    const gcp = settings?.gcp;

    if (!gcp?.accessToken) {
      return {
        body: { error: 'GCP credentials required. Connect a GCP account in Settings.' },
        status: 400,
      };
    }

    if (!gcp.selectedProject) {
      return {
        body: { error: 'GCP project required. Select a project in the UI before running.' },
        status: 400,
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

    let bucketName = '';
    let refreshedToken = gcp.accessToken;

    try {
      refreshedToken = await refreshGcpAccessTokenIfNeeded(gcp) || gcp.accessToken;
      if (refreshedToken) {
        state.gcpCredentials[testId].accessToken = refreshedToken;
      }

      if (workflowId) {
        const result = await ensureBucket(workflowId, refreshedToken, gcp.selectedProject);
        if (!result) {
          return {
            body: { error: 'Failed to create GCS bucket.' },
            status: 500,
          };
        }

        bucketName = result.bucketName;
        state.testBucketNames[testId] = bucketName;
        body.bucketName = bucketName;
      }
    } catch (err: any) {
      return {
        body: { error: `Failed to create GCS bucket: ${err.message}` },
        status: 500,
      };
    }

    try {
      const storage = getStorage(refreshedToken, gcp.selectedProject);
      const bucket = storage.bucket(bucketName);
      const file = bucket.file(`executions/${testId}/payload.json`);
      await file.save(JSON.stringify(body), { contentType: 'application/json' });

      const workflowPayloadUri = `gs://${bucketName}/executions/${testId}/payload.json`;
      console.log(`[workflows] Uploaded workflow payload to ${workflowPayloadUri}`);

      const pubsubTopic = requireEnv('PUBSUB_TOPIC');
      await ensureGcpPubSubSubscription(gcp.selectedProject, refreshedToken);

      const editorApiUrl = `${req.protocol}://${req.get('host')}`;
      const serviceUri = await ensureOrchestratorService(gcp.selectedProject, refreshedToken);

      const executeResponse = await fetch(`${serviceUri}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          editorApiUrl,
          gcpProject: gcp.selectedProject,
          pubsubProjectId: gcp.selectedProject,
          pubsubTopic,
          bucketName,
          testId,
          workflowPayloadUri
        })
      });

      if (!executeResponse.ok) {
        throw new Error(`Failed to execute orchestrator service: ${executeResponse.statusText}`);
      }

      try {
        await this.logTransport.publish(JSON.stringify({
          message: 'Orchestrator Cloud Run Service triggered successfully.',
          level: 'info',
          timestamp: new Date()
        }));
      } catch (error) {
        console.error('Failed to publish execution ID to pubsub', error);
      }

      return {
        body: { message: `Workflow triggered on Cloud Run Service successfully, testId: ${testId}`, execution: 'service-invocation' },
        status: 200,
      };
    } catch (err: any) {
      console.error('[workflows] GCP Run failed:', err);
      return {
        body: { error: `Failed to trigger Cloud Run Service: ${err.message}` },
        status: 500,
      };
    }
  }
}
