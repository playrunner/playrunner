import { Router } from 'express';
import type { IntegrationCredentialStore } from '@playrunner/integration-sdk/api';

const GITHUB_API_VERSION = '2026-03-10';
const GITHUB_API_BASE_URL = (
  process.env.PLAYRUNNER_GITHUB_API_BASE_URL || 'https://api.github.com'
).replace(/\/+$/, '');

const REQUIRED_GITHUB_PERMISSIONS = {
  contents: 'write',
  pull_requests: 'write',
} as const;

function githubApiUrl(path: string) {
  return `${GITHUB_API_BASE_URL}/${path.replace(/^\/+/, '')}`;
}

function credentialStore(req: unknown): IntegrationCredentialStore | undefined {
  return (req as { integrationCredentials?: IntegrationCredentialStore })
    .integrationCredentials;
}

export const githubRouter = Router();
const githubCredentialRefreshes = new Map<string, Promise<void>>();

export const githubApiContribution = {
  id: 'github',
  mountPath: '/api/github',
  router: githubRouter,
  prepareCredentials: refreshGithubCredentials,
};

export default githubApiContribution;

export async function refreshGithubCredentials(
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

  const refreshKey = String(refreshToken);
  const activeRefresh = githubCredentialRefreshes.get(refreshKey);
  if (activeRefresh) {
    await activeRefresh;
    return;
  }

  const refresh = refreshGithubAccessToken(store, {
    clientId: String(clientId),
    clientSecret: String(clientSecret),
    refreshToken: refreshKey,
  }).finally(() => {
    if (githubCredentialRefreshes.get(refreshKey) === refresh) {
      githubCredentialRefreshes.delete(refreshKey);
    }
  });
  githubCredentialRefreshes.set(refreshKey, refresh);
  await refresh;
}

async function refreshGithubAccessToken(
  store: IntegrationCredentialStore,
  credentials: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  },
) {
  const parameters = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken,
    grant_type: 'refresh_token',
  });
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': 'Playrunner-App',
    },
    body: parameters,
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok || typeof data.access_token !== 'string') {
    const errorCode =
      typeof data.error === 'string' ? data.error : 'unknown_error';
    console.warn(
      `GitHub token refresh failed (${response.status}): ${errorCode}.`,
    );
    throw new Error('GitHub authorization has expired. Reconnect GitHub.');
  }
  await store.updateSecrets('integration', 'github', {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || credentials.refreshToken,
    expiresAt: data.expires_in
      ? Date.now() + data.expires_in * 1000
      : undefined,
    refreshTokenExpiresAt: data.refresh_token_expires_in
      ? Date.now() + data.refresh_token_expires_in * 1000
      : undefined,
  });
}

async function exchangeGithubAuthorizationCode(credentials: {
  clientId: string;
  clientSecret: string;
  code: string;
}) {
  const parameters = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    code: credentials.code,
  });
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': 'Playrunner-App',
    },
    body: parameters,
  });
  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok || typeof data.access_token !== 'string') {
    throw Object.assign(new Error('GitHub token exchange failed.'), {
      statusCode: response.status,
    });
  }
  return data;
}

export function buildGithubAuthorizationUrl(input: {
  callbackUrl: string;
  clientId: string;
  state: string;
}) {
  const callbackUrl = new URL(input.callbackUrl);
  if (
    !['http:', 'https:'].includes(callbackUrl.protocol) ||
    callbackUrl.username ||
    callbackUrl.password ||
    callbackUrl.hash
  ) {
    throw Object.assign(new Error('Invalid GitHub OAuth callback URL.'), {
      statusCode: 400,
    });
  }
  if (
    !input.clientId.trim() ||
    !input.state.trim() ||
    input.state.length > 256
  ) {
    throw Object.assign(new Error('Invalid GitHub authorization request.'), {
      statusCode: 400,
    });
  }
  const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', input.clientId);
  authorizeUrl.searchParams.set('redirect_uri', callbackUrl.toString());
  authorizeUrl.searchParams.set('state', input.state);
  return authorizeUrl.toString();
}

export function inspectGithubPermissions(value: unknown) {
  const permissions =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const missingPermissions = Object.entries(REQUIRED_GITHUB_PERMISSIONS)
    .filter(([permission, required]) => permissions[permission] !== required)
    .map(([permission]) => permission);
  return {
    contents:
      typeof permissions.contents === 'string'
        ? permissions.contents
        : 'unknown',
    missingPermissions,
    pullRequests:
      typeof permissions.pull_requests === 'string'
        ? permissions.pull_requests
        : 'unknown',
    reauthorizationRequired: missingPermissions.length > 0,
  };
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
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
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

async function githubGetAllPages<T>(
  github: { get(url: string): Promise<unknown> },
  url: string,
  collectionKey?: string,
): Promise<T[]> {
  const items: T[] = [];
  const pageSize = 100;

  for (let page = 1; ; page += 1) {
    const separator = url.includes('?') ? '&' : '?';
    const data = await github.get(
      `${url}${separator}per_page=${pageSize}&page=${page}`,
    );
    const pageItems = collectionKey
      ? data &&
        typeof data === 'object' &&
        collectionKey in data &&
        Array.isArray(data[collectionKey as keyof typeof data])
        ? (data[collectionKey as keyof typeof data] as T[])
        : []
      : Array.isArray(data)
        ? (data as T[])
        : [];

    items.push(...pageItems);
    if (pageItems.length < pageSize) break;
  }

  return items;
}

// Proxy endpoint to exchange GitHub OAuth code for an access token to bypass CORS
githubRouter.post('/token', async (req, res) => {
  const { code, client_id, client_secret, app_name, installation_id } =
    req.body;

  try {
    const data = await exchangeGithubAuthorizationCode({
      clientId: client_id,
      clientSecret: client_secret,
      code,
    });
    try {
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
          expiresAt:
            typeof data.expires_in === 'number'
              ? Date.now() + data.expires_in * 1000
              : undefined,
          refreshTokenExpiresAt:
            typeof data.refresh_token_expires_in === 'number'
              ? Date.now() + data.refresh_token_expires_in * 1000
              : undefined,
        },
      });
      return res.json({ connected: true });
    } catch (error) {
      console.error('Token exchange failed:', error);
      res.status(500).json({ error: 'Failed to exchange token' });
    }
  } catch (err) {
    console.error('Token exchange error:', err);
    res.status(500).json({ error: 'Failed to exchange token' });
  }
});

githubRouter.post('/reauthorize', async (req, res) => {
  try {
    const store = credentialStore(req);
    if (!store) {
      return res
        .status(500)
        .json({ error: 'Credential storage is unavailable.' });
    }
    const connection = await store.resolve('integration', 'github');
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    const clientId = connection?.secrets.clientId;
    const clientSecret = connection?.secrets.clientSecret;
    if (
      !code ||
      typeof clientId !== 'string' ||
      !clientId ||
      typeof clientSecret !== 'string' ||
      !clientSecret
    ) {
      return res.status(400).json({
        error:
          'Saved GitHub credentials are incomplete. Change credentials and authenticate again.',
      });
    }
    const data = await exchangeGithubAuthorizationCode({
      clientId,
      clientSecret,
      code,
    });
    await store.updateSecrets('integration', 'github', {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || connection.secrets.refreshToken,
      expiresAt:
        typeof data.expires_in === 'number'
          ? Date.now() + data.expires_in * 1000
          : undefined,
      refreshTokenExpiresAt:
        typeof data.refresh_token_expires_in === 'number'
          ? Date.now() + data.refresh_token_expires_in * 1000
          : undefined,
    });
    return res.json({ connected: true });
  } catch (error) {
    console.error('GitHub reauthorization failed:', error);
    return res.status(errorStatusCode(error) || 500).json({
      error:
        error instanceof Error
          ? error.message
          : 'Failed to reauthorize GitHub.',
    });
  }
});

githubRouter.post('/reauthorize-url', async (req, res) => {
  try {
    const store = credentialStore(req);
    if (!store) {
      return res
        .status(500)
        .json({ error: 'Credential storage is unavailable.' });
    }
    const connection = await store.resolve('integration', 'github');
    const clientId = connection?.secrets.clientId;
    const callbackUrl =
      typeof req.body?.callbackUrl === 'string' ? req.body.callbackUrl : '';
    const state = typeof req.body?.state === 'string' ? req.body.state : '';
    if (typeof clientId !== 'string' || !clientId.trim()) {
      return res.status(400).json({
        error:
          'Saved GitHub credentials are incomplete. Change credentials and authenticate again.',
      });
    }
    return res.json({
      authorizeUrl: buildGithubAuthorizationUrl({
        callbackUrl,
        clientId,
        state,
      }),
    });
  } catch (error) {
    console.error('Failed to start GitHub reauthorization:', error);
    return res.status(errorStatusCode(error) || 500).json({
      error:
        error instanceof Error
          ? error.message
          : 'Failed to start GitHub reauthorization.',
    });
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

githubRouter.get('/connection-status', async (req, res) => {
  try {
    const github = await createGithubApiClient(req);
    const { connection } = github;
    const savedInstallationId = connection.config.installationId;
    const appSlug =
      typeof connection.config.appSlug === 'string'
        ? connection.config.appSlug
        : typeof connection.config.appName === 'string'
          ? connection.config.appName
          : '';
    let installation: Record<string, unknown> | undefined;
    if (
      (typeof savedInstallationId === 'string' && savedInstallationId) ||
      typeof savedInstallationId === 'number'
    ) {
      installation = (await github.get(
        githubApiUrl(
          `user/installations/${encodeURIComponent(String(savedInstallationId))}`,
        ),
      )) as Record<string, unknown>;
    } else {
      const installations = await githubGetAllPages<Record<string, unknown>>(
        github,
        githubApiUrl('user/installations'),
        'installations',
      );
      installation = installations.find(
        (candidate) =>
          !appSlug ||
          (typeof candidate.app_slug === 'string' &&
            candidate.app_slug.toLowerCase() === appSlug.toLowerCase()),
      );
    }
    const permissionStatus = inspectGithubPermissions(
      installation?.permissions,
    );
    return res.json({
      appSlug,
      connected: true,
      installationFound: Boolean(installation),
      ...permissionStatus,
    });
  } catch (error) {
    console.error('Failed to inspect GitHub connection:', error);
    return res.status(errorStatusCode(error) || 500).json({
      error:
        error instanceof Error
          ? error.message
          : 'Failed to inspect GitHub connection.',
    });
  }
});

githubRouter.get('/repositories', async (req, res) => {
  try {
    const github = await createGithubApiClient(req);
    const { connection } = github;
    const configuredRepository = connection.config.repository;
    const savedInstallationId = connection.config.installationId;
    const hasSavedInstallationId =
      (typeof savedInstallationId === 'string' &&
        Boolean(savedInstallationId)) ||
      typeof savedInstallationId === 'number';
    if (
      !hasSavedInstallationId &&
      typeof configuredRepository === 'string' &&
      /^[^/]+\/[^/]+$/.test(configuredRepository)
    ) {
      const [owner, repositoryName] = configuredRepository.split('/');
      const repository = (await github.get(
        githubApiUrl(
          `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repositoryName)}`,
        ),
      )) as { full_name?: unknown; id?: unknown };
      if (
        (typeof repository.id === 'string' ||
          typeof repository.id === 'number') &&
        typeof repository.full_name === 'string'
      ) {
        return res.json({
          repositories: [
            { id: String(repository.id), full_name: repository.full_name },
          ],
        });
      }
    }
    let installationIds: string[] = [];

    if (hasSavedInstallationId) {
      installationIds = [String(savedInstallationId)];
    } else {
      const installations = await githubGetAllPages<{
        id?: string | number;
      }>(github, githubApiUrl('user/installations'), 'installations');
      installationIds = installations
        .map((installation) => installation.id)
        .filter(
          (id): id is string | number =>
            (typeof id === 'string' && Boolean(id)) || typeof id === 'number',
        )
        .map(String);
    }

    const repositoryLists = await Promise.all(
      installationIds.map(async (installationId) => {
        return githubGetAllPages<{
          id?: string | number;
          full_name?: string;
        }>(
          github,
          githubApiUrl(
            `user/installations/${encodeURIComponent(installationId)}/repositories`,
          ),
          'repositories',
        );
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
      .filter(
        (repository, index, all) =>
          all.findIndex((candidate) => candidate.id === repository.id) ===
          index,
      )
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
    const data = await githubGetAllPages<{ name?: string }>(
      github,
      githubApiUrl(
        `repos/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}/branches`,
      ),
    );
    const branches = data
      .filter(
        (branch): branch is { name: string } => typeof branch.name === 'string',
      )
      .map((branch) => ({ name: branch.name }));

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
