import path from 'path';
import fs from 'fs';
import { Storage } from '@google-cloud/storage';
import { OAuth2Client } from 'google-auth-library';

type Bucket = ReturnType<Storage['bucket']>;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set for GCP storage integration.`);
  }
  return value;
}

function bucketName(workflowId: string): string {
  const sanitized = workflowId.toLowerCase().replace(/[^a-z0-9-_.]/g, '-').replace(/^-+|-+$/g, '');
  return `${requireEnv('GCS_BUCKET_PREFIX')}-${sanitized}`;
}

function resolveProjectId(projectId?: string): string {
  return projectId || requireEnv('GCS_PROJECT_ID');
}

export interface GcpTokenRefresh {
  accessToken: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  expiresAt?: number;
}

export async function refreshGcpAccessTokenIfNeeded(creds: GcpTokenRefresh): Promise<string | null> {
  console.log("[GCS] refreshGcpAccessTokenIfNeeded: hasRefreshToken=" + !!creds.refreshToken +
    " hasClientId=" + !!creds.clientId + " hasClientSecret=" + !!creds.clientSecret +
    " hasExpiresAt=" + !!creds.expiresAt +
    (creds.expiresAt ? " expiresIn=" + Math.round((creds.expiresAt - Date.now()) / 1000) + "s" : ""));

  if (!creds.refreshToken || !creds.clientId || !creds.clientSecret) {
    console.log("[GCS] Skipping token refresh: missing refreshToken, clientId, or clientSecret");
    return null;
  }

  const isExpired = !creds.expiresAt || (Date.now() + 5 * 60 * 1000 > creds.expiresAt);
  if (!isExpired) {
    console.log("[GCS] Token is still valid, no refresh needed");
    return null;
  }

  try {
    console.log("[GCS] Token is expired or expiring soon, calling Google OAuth2 token endpoint...");
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: creds.refreshToken,
        grant_type: 'refresh_token'
      })
    });

    const tokenData = await res.json();
    console.log("[GCS] Google OAuth2 refresh response status: " + res.status +
      " hasAccessToken: " + !!tokenData.access_token +
      (tokenData.error ? " error: " + tokenData.error + " " + (tokenData.error_description || "") : ""));

    if (tokenData.access_token) {
      console.log("[GCS] Token refreshed successfully, new token length: " + tokenData.access_token.length);
      return tokenData.access_token;
    }
  } catch (e) {
    console.error("[GCS] Token refresh network error:", e);
  }
  return null;
}

export function getStorage(accessToken: string, projectId?: string): Storage {
  const project = resolveProjectId(projectId);
  console.log("[GCS] getStorage: using OAuth user token (length=" + (accessToken?.length || 0) +
    " prefix=" + (accessToken ? accessToken.substring(0, 10) + "..." : "none") +
    " projectId=" + project);

  const oauth2Client = new OAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  const authClient = {
    getRequestHeaders: async (url?: string) => {
      const headers = await oauth2Client.getRequestHeaders(url);
      const plainHeaders: Record<string, string> = {};
      if (headers && typeof (headers as any).forEach === 'function') {
        (headers as any).forEach((value: string, key: string) => {
          plainHeaders[key] = value;
        });
      } else if (headers) {
        Object.assign(plainHeaders, headers);
      }
      return plainHeaders;
    },
    request: async (opts: any) => {
      if (opts.uri && !opts.url) {
        opts.url = opts.uri;
      }
      const res = await oauth2Client.request(opts);
      if (res && res.headers && typeof (res.headers as any).forEach === 'function') {
        const plainHeaders: Record<string, string> = {};
        (res.headers as any).forEach((value: string, key: string) => {
          plainHeaders[key] = value;
        });

        return new Proxy(res, {
          get(target, prop) {
            if (prop === 'headers') return plainHeaders;
            const value = target[prop as keyof typeof target];
            if (typeof value === 'function') {
              return value.bind(target);
            }
            return value;
          }
        });
      }
      return res;
    }
  };

  return new Storage({ projectId: project, authClient: authClient as any });
}

export async function ensureBucket(workflowId: string, accessToken: string, projectId?: string): Promise<{ bucket: Bucket; bucketName: string; created: boolean } | null> {
  console.log("[GCS] ensureBucket: tokenLength=" + (accessToken?.length || 0) +
    " projectId=" + (projectId || "auto") + " bucketPrefix=" + requireEnv('GCS_BUCKET_PREFIX') + " workflowId=" + workflowId);

  const storage = getStorage(accessToken, projectId);
  const name = bucketName(workflowId);
  const bucket = storage.bucket(name);

  try {
    console.log("[GCS] Checking if bucket exists: " + name);
    const [exists] = await bucket.exists();
    if (exists) {
      console.log(`GCS bucket "${name}" already exists`);
      return { bucket, bucketName: name, created: false };
    }

    console.log("[GCS] Creating bucket: " + name + " in project: " + (projectId || "default"));
    await bucket.create();
    console.log(`GCS bucket "${name}" created`);
    return { bucket, bucketName: name, created: true };
  } catch (err: any) {
    console.error(`[GCS] Failed to create/check GCS bucket "${name}":`, err.message);
    if (err.code) console.error(`[GCS] Error code: ${err.code}`);
    if (err.errors) console.error(`[GCS] Error details:`, JSON.stringify(err.errors));
    return null;
  }
}

export async function uploadFile(
  bucket: Bucket,
  localPath: string,
  remotePath: string
): Promise<boolean> {
  try {
    await bucket.upload(localPath, { destination: remotePath });
    console.log(`Uploaded ${localPath} → gs://${bucket.name}/${remotePath}`);
    return true;
  } catch (err: any) {
    console.error(`Failed to upload ${localPath}:`, err.message);
    return false;
  }
}

export async function uploadDirectory(
  bucket: Bucket,
  localDir: string,
  remotePrefix: string
): Promise<{ uploaded: number; failed: number }> {
  let uploaded = 0;
  let failed = 0;

  if (!fs.existsSync(localDir)) {
    return { uploaded, failed };
  }

  const walkDir = (dir: string): string[] => {
    let results: string[] = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat && stat.isDirectory()) {
        results = results.concat(walkDir(filePath));
      } else {
        results.push(filePath);
      }
    }
    return results;
  };

  const files = walkDir(localDir);

  for (const filePath of files) {
    const relativePath = path.relative(localDir, filePath);
    const remotePath = `${remotePrefix.replace(/\/$/, '')}/${relativePath}`;
    const ok = await uploadFile(bucket, filePath, remotePath);
    if (ok) uploaded++;
    else failed++;
  }

  console.log(`GCS upload complete: ${uploaded} uploaded, ${failed} failed from ${localDir}`);
  return { uploaded, failed };
}
