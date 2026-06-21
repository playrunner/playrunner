import {
  getStorage,
  refreshGcpAccessTokenIfNeeded,
  uploadDirectory,
} from '../services/gcs';
import { state } from '../state';
import type { OutputSyncBackend, OutputSyncRequest } from './contracts';

export class GcpOutputSyncBackend implements OutputSyncBackend {
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

    const gcp = state.gcpCredentials[testId];
    if (!gcp?.accessToken) {
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
