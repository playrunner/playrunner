import { Router } from 'express';
import type { IntegrationCredentialStore } from '@playrunner/integration-sdk/api';

function credentialStore(req: unknown): IntegrationCredentialStore | undefined {
  return (req as { integrationCredentials?: IntegrationCredentialStore })
    .integrationCredentials;
}

export const githubRouter = Router();

export const githubApiContribution = {
  id: 'github',
  mountPath: '/api/github',
  router: githubRouter,
  prepareCredentials: refreshGithubCredentials,
};

export default githubApiContribution;

async function refreshGithubCredentials(
  store: IntegrationCredentialStore,
  _kind?: 'cloud' | 'integration',
  force = false,
) {
  const connection = await store.resolve('integration', 'github');
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
      throw new Error('Saved GitHub refresh credentials are incomplete.');
    return;
  }
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'Playrunner-App',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = (await response.json()) as Record<string, any>;
  if (!response.ok || typeof data.access_token !== 'string')
    throw new Error('GitHub authorization has expired. Reconnect GitHub.');
  await store.updateSecrets('integration', 'github', {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: data.expires_in
      ? Date.now() + data.expires_in * 1000
      : undefined,
    refreshTokenExpiresAt: data.refresh_token_expires_in
      ? Date.now() + data.refresh_token_expires_in * 1000
      : undefined,
  });
}

async function getGithubConnection(req: unknown) {
  const store = credentialStore(req);
  if (!store) {
    throw Object.assign(new Error('Credential storage is unavailable.'), {
      statusCode: 500,
    });
  }
  await refreshGithubCredentials(store);
  const connection = await store.resolve('integration', 'github');
  const accessToken = connection?.secrets.accessToken;
  if (typeof accessToken !== 'string' || !accessToken) {
    throw Object.assign(new Error('GitHub is not connected.'), {
      statusCode: 401,
    });
  }
  return { accessToken, connection, store };
}

async function githubGet(accessToken: string, url: string) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      data &&
      typeof data === 'object' &&
      'message' in data &&
      typeof data.message === 'string'
        ? data.message
        : 'GitHub API request failed.';
    throw Object.assign(new Error(message), { statusCode: response.status });
  }
  return data;
}

function errorStatusCode(error: unknown) {
  return error &&
    typeof error === 'object' &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
    ? error.statusCode
    : undefined;
}

async function createGithubApiClient(req: unknown) {
  const {
    accessToken: initialAccessToken,
    connection,
    store,
  } = await getGithubConnection(req);
  let accessToken = initialAccessToken;
  let refreshPromise: Promise<void> | undefined;

  async function refreshAccessTokenOnce() {
    refreshPromise ??= (async () => {
      await refreshGithubCredentials(store, 'integration', true);
      const refreshed = await store.resolve('integration', 'github');
      const refreshedAccessToken = refreshed?.secrets.accessToken;
      if (typeof refreshedAccessToken !== 'string' || !refreshedAccessToken) {
        throw new Error('GitHub authorization has expired. Reconnect GitHub.');
      }
      accessToken = refreshedAccessToken;
    })();
    await refreshPromise;
  }

  return {
    connection,
    async get(url: string) {
      try {
        return await githubGet(accessToken, url);
      } catch (error) {
        if (errorStatusCode(error) !== 401) throw error;
        await refreshAccessTokenOnce();
        return githubGet(accessToken, url);
      }
    },
  };
}

// Proxy endpoint to exchange GitHub OAuth code for an access token to bypass CORS
githubRouter.post('/token', async (req, res) => {
  const { code, client_id, client_secret, app_name, installation_id } =
    req.body;

  try {
    const gRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'Playrunner-App',
      },
      body: JSON.stringify({
        client_id,
        client_secret,
        code,
      }),
    });

    const text = await gRes.text();
    try {
      const data = JSON.parse(text);
      if (!gRes.ok || !data.access_token) {
        return res
          .status(gRes.status)
          .json({ error: 'GitHub token exchange failed.' });
      }
      const store = credentialStore(req);
      if (!store) {
        return res
          .status(500)
          .json({ error: 'Credential storage is unavailable.' });
      }
      await store.save('integration', 'github', {
        provider: 'github',
        config: {
          appName: app_name,
          appSlug: app_name,
          ...(installation_id ? { installationId: installation_id } : {}),
        },
        secrets: {
          clientId: client_id,
          clientSecret: client_secret,
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: data.expires_in
            ? Date.now() + data.expires_in * 1000
            : undefined,
          refreshTokenExpiresAt: data.refresh_token_expires_in
            ? Date.now() + data.refresh_token_expires_in * 1000
            : undefined,
        },
      });
      return res.json({ connected: true });
    } catch {
      console.error('Token exchange failed. GitHub returned non-JSON.');
      res.status(500).json({ error: 'Failed to exchange token' });
    }
  } catch (err) {
    console.error('Token exchange error:', err);
    res.status(500).json({ error: 'Failed to exchange token' });
  }
});

// Proxy endpoint to refresh GitHub OAuth token
githubRouter.post('/refresh', async (req, res) => {
  try {
    const store = credentialStore(req);
    if (!store)
      return res
        .status(500)
        .json({ error: 'Credential storage is unavailable.' });
    await refreshGithubCredentials(store, 'integration', true);
    return res.json({ connected: true });
  } catch (err) {
    console.error('Token refresh error:', err);
    return res.status(500).json({ error: 'Failed to refresh token' });
  }
});

githubRouter.get('/repositories', async (req, res) => {
  try {
    const github = await createGithubApiClient(req);
    const { connection } = github;
    const savedInstallationId = connection.config.installationId;
    let installationIds: string[] = [];

    if (
      (typeof savedInstallationId === 'string' && savedInstallationId) ||
      typeof savedInstallationId === 'number'
    ) {
      installationIds = [String(savedInstallationId)];
    } else {
      const installations = (await github.get(
        'https://api.github.com/user/installations?per_page=100',
      )) as { installations?: Array<{ id?: string | number }> };
      installationIds = (installations.installations ?? [])
        .map((installation) => installation.id)
        .filter(
          (id): id is string | number =>
            (typeof id === 'string' && Boolean(id)) || typeof id === 'number',
        )
        .map(String);
    }

    const repositoryLists = await Promise.all(
      installationIds.map(async (installationId) => {
        const data = (await github.get(
          `https://api.github.com/user/installations/${encodeURIComponent(installationId)}/repositories?per_page=100`,
        )) as {
          repositories?: Array<{ id?: string | number; full_name?: string }>;
        };
        return data.repositories ?? [];
      }),
    );
    const repositories = repositoryLists
      .flat()
      .filter(
        (
          repository,
        ): repository is { id: string | number; full_name: string } =>
          (typeof repository.id === 'string' ||
            typeof repository.id === 'number') &&
          typeof repository.full_name === 'string',
      )
      .map((repository) => ({
        id: String(repository.id),
        full_name: repository.full_name,
      }))
      .sort((left, right) => left.full_name.localeCompare(right.full_name));

    return res.json({ repositories });
  } catch (error) {
    console.error('Failed to fetch GitHub repositories:', error);
    const statusCode =
      error &&
      typeof error === 'object' &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to fetch GitHub repositories.';
    return res.status(statusCode).json({ error: message });
  }
});

githubRouter.get('/branches', async (req, res) => {
  try {
    const repository =
      typeof req.query.repository === 'string'
        ? req.query.repository.trim()
        : '';
    const parts = repository.split('/');
    if (parts.length !== 2 || parts.some((part) => !part)) {
      return res
        .status(400)
        .json({ error: 'Repository must use the owner/name format.' });
    }

    const github = await createGithubApiClient(req);
    const data = (await github.get(
      `https://api.github.com/repos/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}/branches?per_page=100`,
    )) as Array<{ name?: string }>;
    const branches = Array.isArray(data)
      ? data
          .filter(
            (branch): branch is { name: string } =>
              typeof branch.name === 'string',
          )
          .map((branch) => ({ name: branch.name }))
      : [];

    return res.json({ branches });
  } catch (error) {
    console.error('Failed to fetch GitHub branches:', error);
    const statusCode =
      error &&
      typeof error === 'object' &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to fetch GitHub branches.';
    return res.status(statusCode).json({ error: message });
  }
});
