import { Router } from 'express';
import type { IntegrationCredentialStore } from '@playrunner/integration-sdk/api';

function credentialStore(req: unknown): IntegrationCredentialStore | undefined {
  return (req as { integrationCredentials?: IntegrationCredentialStore })
    .integrationCredentials;
}

export const gcpRouter = Router();

export const gcpApiContribution = {
  id: 'gcp',
  mountPath: '/api/gcp',
  router: gcpRouter,
  prepareCredentials: refreshGcpCredentials,
};

export default gcpApiContribution;

async function refreshGcpCredentials(
  store: IntegrationCredentialStore,
  kind: 'cloud' | 'integration',
) {
  if (kind !== 'cloud') return;
  const connection = await store.resolve('cloud', 'gcp');
  if (!connection) return;
  const expiresAt = connection.secrets.expiresAt;
  if (typeof expiresAt !== 'number' || Date.now() < expiresAt - 5 * 60 * 1000)
    return;
  const { clientId, clientSecret, refreshToken } = connection.secrets;
  if (
    ![clientId, clientSecret, refreshToken].every(
      (value) => typeof value === 'string' && value,
    )
  )
    return;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = (await response.json()) as Record<string, any>;
  if (!response.ok || typeof data.access_token !== 'string')
    throw new Error('GCP authorization has expired. Reconnect GCP.');
  await store.updateSecrets('cloud', 'gcp', {
    accessToken: data.access_token,
    expiresAt: data.expires_in
      ? Date.now() + data.expires_in * 1000
      : undefined,
  });
}

gcpRouter.post('/token', async (req, res) => {
  const { code, client_id, client_secret, redirect_uri } = req.body;

  try {
    const gRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id,
        client_secret,
        code,
        grant_type: 'authorization_code',
        redirect_uri,
      }),
    });

    const text = await gRes.text();
    try {
      const data = JSON.parse(text);
      if (!gRes.ok) {
        console.error('GCP token exchange failed with status:', gRes.status);
        return res.status(gRes.status).json(data);
      }
      const store = credentialStore(req);
      if (!data.access_token || !store) {
        return res
          .status(500)
          .json({ error: 'Credential storage is unavailable.' });
      }
      await store.save('cloud', 'gcp', {
        provider: 'gcp',
        secrets: {
          clientId: client_id,
          clientSecret: client_secret,
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: data.expires_in
            ? Date.now() + data.expires_in * 1000
            : undefined,
        },
      });
      return res.json({ connected: true });
    } catch {
      console.error('Token exchange failed. GCP returned non-JSON.');
      res.status(500).json({ error: 'Failed to exchange token' });
    }
  } catch (err) {
    console.error('Token exchange error:', err);
    res.status(500).json({ error: 'Failed to exchange token' });
  }
});

gcpRouter.post('/refresh', async (req, res) => {
  const store = credentialStore(req);
  const connection = await store?.resolve('cloud', 'gcp');
  const refresh_token = connection?.secrets.refreshToken;
  const client_id = connection?.secrets.clientId;
  const client_secret = connection?.secrets.clientSecret;
  if (
    ![refresh_token, client_id, client_secret].every(
      (value) => typeof value === 'string' && value,
    )
  ) {
    return res
      .status(400)
      .json({ error: 'Saved GCP refresh credentials are incomplete.' });
  }

  try {
    const gRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id,
        client_secret,
        refresh_token,
        grant_type: 'refresh_token',
      }),
    });

    const text = await gRes.text();
    try {
      const data = JSON.parse(text);
      if (!gRes.ok) {
        console.error('GCP token refresh failed with status:', gRes.status);
        return res.status(gRes.status).json(data);
      }
      if (!data.access_token || !store) {
        return res.status(502).json({ error: 'GCP token refresh failed.' });
      }
      await store.updateSecrets('cloud', 'gcp', {
        accessToken: data.access_token,
        expiresAt: data.expires_in
          ? Date.now() + data.expires_in * 1000
          : undefined,
      });
      return res.json({ connected: true });
    } catch {
      console.error('Token refresh failed. GCP returned non-JSON.');
      res.status(500).json({ error: 'Failed to refresh token' });
    }
  } catch (err) {
    console.error('Token refresh error:', err);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

gcpRouter.get('/projects', async (req, res) => {
  try {
    const store = credentialStore(req);
    let connection = await store?.resolve('cloud', 'gcp');
    if (!connection)
      return res.status(404).json({ error: 'GCP is not connected.' });

    const expiresAt = connection.secrets.expiresAt;
    if (
      typeof expiresAt === 'number' &&
      Date.now() > expiresAt - 5 * 60 * 1000
    ) {
      const refreshResponse = await fetch(
        'https://oauth2.googleapis.com/token',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            client_id: connection.secrets.clientId,
            client_secret: connection.secrets.clientSecret,
            refresh_token: connection.secrets.refreshToken,
            grant_type: 'refresh_token',
          }),
        },
      );
      const refreshed = (await refreshResponse.json()) as Record<string, any>;
      if (!refreshResponse.ok || typeof refreshed.access_token !== 'string') {
        return res
          .status(401)
          .json({ error: 'GCP authorization has expired. Reconnect GCP.' });
      }
      await store!.updateSecrets('cloud', 'gcp', {
        accessToken: refreshed.access_token,
        expiresAt: refreshed.expires_in
          ? Date.now() + refreshed.expires_in * 1000
          : undefined,
      });
      connection = await store!.resolve('cloud', 'gcp');
    }

    const accessToken = connection?.secrets.accessToken;
    if (typeof accessToken !== 'string' || !accessToken) {
      return res.status(401).json({ error: 'GCP is not authenticated.' });
    }
    const projects: Array<{ name?: string; projectId: string }> = [];
    let pageToken = '';
    do {
      const url = new URL(
        'https://cloudresourcemanager.googleapis.com/v1/projects',
      );
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = (await response.json()) as Record<string, any>;
      if (!response.ok) return res.status(response.status).json(data);
      for (const project of Array.isArray(data.projects) ? data.projects : []) {
        if (typeof project.projectId === 'string' && project.projectId.trim()) {
          projects.push({
            name: typeof project.name === 'string' ? project.name : '',
            projectId: project.projectId,
          });
        }
      }
      pageToken =
        typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
    } while (pageToken);
    return res.json({ projects });
  } catch (error) {
    console.error('Failed to fetch GCP projects:', error);
    return res.status(500).json({ error: 'Failed to fetch GCP projects.' });
  }
});
