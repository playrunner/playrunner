import { Router } from 'express';
import type { IntegrationCredentialStore } from '@playrunner/integration-sdk/api';

function credentialStore(req: unknown): IntegrationCredentialStore | undefined {
  return (req as { integrationCredentials?: IntegrationCredentialStore })
    .integrationCredentials;
}

export const jiraRouter = Router();

export const jiraApiContribution = {
  id: 'jira',
  mountPath: '/api/jira',
  router: jiraRouter,
  prepareCredentials: refreshJiraCredentials,
};

export default jiraApiContribution;

async function refreshJiraCredentials(
  store: IntegrationCredentialStore,
  _kind?: 'cloud' | 'integration',
  force = false,
) {
  const connection = await store.resolve('integration', 'jira');
  if (!connection) return;
  const expiresAt = connection.secrets.expiresAt;
  if (
    !force &&
    (typeof expiresAt !== 'number' || Date.now() < expiresAt - 5 * 60 * 1000)
  )
    return;
  const { clientId, clientSecret, refreshToken } = connection.secrets;
  const hasRefreshCredentials = [clientId, clientSecret, refreshToken].every(
    (value) => typeof value === 'string' && value,
  );
  if (!hasRefreshCredentials) {
    if (force)
      throw new Error('Saved Jira refresh credentials are incomplete.');
    return;
  }
  const response = await fetch('https://auth.atlassian.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });
  const data = (await response.json()) as Record<string, any>;
  if (!response.ok || typeof data.access_token !== 'string')
    throw new Error('Jira authorization has expired. Reconnect Jira.');
  await store.updateSecrets('integration', 'jira', {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: data.expires_in
      ? Date.now() + data.expires_in * 1000
      : undefined,
  });
}

jiraRouter.post('/token', async (req, res) => {
  const { code, client_id, client_secret, redirect_uri } = req.body;

  try {
    const jRes = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id,
        client_secret,
        code,
        redirect_uri,
      }),
    });

    const text = await jRes.text();

    try {
      const data = JSON.parse(text);

      if (!jRes.ok) {
        console.error('Jira token exchange failed with status:', jRes.status);
        return res.status(jRes.status).json(data);
      }

      const store = credentialStore(req);
      if (!data.access_token || !store) {
        return res
          .status(500)
          .json({ error: 'Credential storage is unavailable.' });
      }
      await store.save('integration', 'jira', {
        provider: 'jira',
        config: {},
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
      console.error('Token exchange failed. Jira returned non-JSON.');
      return res.status(500).json({ error: 'Failed to exchange token' });
    }
  } catch (err) {
    console.error('Token exchange error:', err);
    return res.status(500).json({ error: 'Failed to exchange token' });
  }
});

jiraRouter.post('/refresh', async (req, res) => {
  try {
    const store = credentialStore(req);
    if (!store)
      return res
        .status(500)
        .json({ error: 'Credential storage is unavailable.' });
    await refreshJiraCredentials(store, 'integration', true);
    return res.json({ connected: true });
  } catch (err) {
    console.error('Token refresh error:', err);
    return res.status(500).json({ error: 'Failed to refresh token' });
  }
});

jiraRouter.get('/projects', async (req, res) => {
  const store = credentialStore(req);
  if (store) await refreshJiraCredentials(store);
  const connection = await store?.resolve('integration', 'jira');
  const token = connection?.secrets.accessToken;

  if (typeof token !== 'string' || !token) {
    return res.status(401).json({ error: 'Jira is not connected.' });
  }

  try {
    const resourceRes = await fetch(
      'https://api.atlassian.com/oauth/token/accessible-resources',
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (!resourceRes.ok) {
      const errData = await resourceRes.json().catch(() => ({}));
      return res.status(resourceRes.status).json(errData);
    }

    const resources = await resourceRes.json();

    if (!resources || resources.length === 0) {
      return res.json({ cloudId: null, projects: [] });
    }

    const cloudId = resources[0].id;
    const projectsRes = await fetch(
      `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project?expand=issueTypes`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      },
    );

    if (!projectsRes.ok) {
      const errData = await projectsRes.json().catch(() => ({}));
      return res.status(projectsRes.status).json(errData);
    }

    const projects = await projectsRes.json();
    return res.json({ cloudId, projects });
  } catch (err) {
    console.error('Failed to fetch Jira projects:', err);
    return res.status(500).json({ error: 'Failed to fetch Jira projects' });
  }
});
