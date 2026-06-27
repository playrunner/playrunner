import {
  getStorage,
  refreshGcpAccessTokenIfNeeded,
  uploadDirectory,
} from './gcs';
import type { GcpRuntimeState } from './contracts';
import type { OutputSyncBackend, OutputSyncRequest } from './contracts';

export class GcpOutputSyncBackend implements OutputSyncBackend {
  constructor(private readonly state: GcpRuntimeState) {}

  async sync(request: OutputSyncRequest): Promise<void> {
    const { bucketName, cloudProvider, nodeId, outputsDir, testId } = request;

    if (!bucketName) {
      return;
    }

    if (cloudProvider !== 'GCP') {
      console.log(
        `Skipping GCS upload for test ${testId} — cloudProvider=${cloudProvider}`,
      );
      return;
    }

    const gcp = this.state.gcpCredentials[testId];
    if (!gcp?.accessToken || !gcp.selectedProject) {
      throw new Error('GCP credentials expired or missing for this test run.');
    }

    const refreshedToken = await refreshGcpAccessTokenIfNeeded(gcp);
    const token = refreshedToken || gcp.accessToken;
    const storage = getStorage(token, gcp.selectedProject);
    const bucket = storage.bucket(bucketName);
    const remotePrefix = `${testId}/${nodeId}`;

    uploadDirectory(bucket, outputsDir, remotePrefix).catch((err) => {
      console.error(`GCS upload failed for ${testId}/${nodeId}:`, err.message);
    });
  }
}
