import type { Request, Response } from 'express';
import { getStorage, refreshGcpAccessTokenIfNeeded } from '../services/gcs';
import { state } from '../state';
import type { OutputProxyBackend } from './contracts';

export class GcpOutputProxyBackend implements OutputProxyBackend {
  async tryHandle(req: Request, res: Response): Promise<boolean> {
    const parts = req.path.split('/').filter(Boolean);
    if (parts.length < 2) {
      return false;
    }

    const testId = parts[0];
    const cloudProvider = state.testCloudProviders[testId] || 'LOCAL_RUNNER';
    if (cloudProvider !== 'GCP') {
      return false;
    }

    const bucketName = state.testBucketNames[testId];
    const gcp = state.gcpCredentials[testId];
    if (!bucketName || !gcp?.accessToken) {
      return false;
    }

    try {
      const refreshedToken = await refreshGcpAccessTokenIfNeeded(gcp);
      const token = refreshedToken || gcp.accessToken;
      const storage = getStorage(token, gcp.selectedProject);
      const bucket = storage.bucket(bucketName);
      const gcsPath = req.path.replace(/^\//, '');
      const file = bucket.file(gcsPath);

      const [exists] = await file.exists();
      if (!exists) {
        return false;
      }

      const stream = file.createReadStream();
      stream.on('error', (err) => {
        console.error(`GCS Stream error for ${gcsPath}:`, err);
        if (!res.headersSent) {
          res.status(500).send('Stream error');
        }
      });

      stream.pipe(res);
      return true;
    } catch (err) {
      console.error('Failed to proxy from GCS:', err);
      return false;
    }
  }
}
