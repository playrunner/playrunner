import { Router } from 'express';
import {
  getIntegrationCredentialStore,
  type IntegrationApiContribution,
  type IntegrationCredentialStore,
} from '@playrunner/integration-sdk/api';

import { teamsScopes } from '../scopes';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function tenant(value: unknown): string {
  const result = text(value);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(result)) {
    throw new Error('Enter a valid Microsoft tenant ID or domain.');
  }
  return result;
}

function baseUrl(kind: 'auth' | 'graph'): string {
  return (
    kind === 'auth'
      ? process.env.PLAYRUNNER_TEAMS_AUTH_BASE_URL ||
        'https://login.microsoftonline.com'
      : process.env.PLAYRUNNER_TEAMS_GRAPH_BASE_URL ||
        'https://graph.microsoft.com'
  ).replace(/\/+$/, '');
}

async function exchange(tenantId: string, params: URLSearchParams) {
  const response = await fetch(
    `${baseUrl('auth')}/${tenant(tenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    },
  );
  const data = await response.json();
  if (
    !response.ok ||
    !text(data.access_token) ||
    !Number.isFinite(data.expires_in) ||
    data.expires_in <= 0
  ) {
    throw new Error(
      'Microsoft Teams authorization failed. Reconnect your account.',
    );
  }
  return {
    accessToken: text(data.access_token),
    refreshToken: text(data.refresh_token),
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

export async function refreshTeamsCredentials(
  store: IntegrationCredentialStore,
) {
  const connection = await store.resolve('integration', 'teams');
  if (!connection) return;
  const { secrets, config } = connection;
  if (
    typeof secrets.expiresAt === 'number' &&
    Date.now() < secrets.expiresAt - 300_000
  )
    return;
  if (
    ![secrets.clientId, secrets.clientSecret, secrets.refreshToken].every(text)
  ) {
    throw new Error(
      'Microsoft Teams authorization has expired. Reconnect your account.',
    );
  }
  try {
    const tokens = await exchange(
      tenant(config.tenantId),
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: text(secrets.clientId),
        client_secret: text(secrets.clientSecret),
        refresh_token: text(secrets.refreshToken),
        scope: teamsScopes,
      }),
    );
    await store.updateSecrets('integration', 'teams', {
      ...tokens,
      refreshToken: tokens.refreshToken || secrets.refreshToken,
    });
  } catch {
    throw new Error(
      'Microsoft Teams authorization has expired. Reconnect your account.',
    );
  }
}

export const teamsRouter = Router();

teamsRouter.post('/oauth-token', async (req, res) => {
  const store = getIntegrationCredentialStore(req);
  if (!store)
    return res
      .status(500)
      .json({ error: 'Credential storage is unavailable.' });
  const body = req.body ?? {};
  let tenantId: string;
  try {
    tenantId = tenant(body.tenantId);
    const redirect = new URL(text(body.redirectUri));
    if (
      !text(body.code) ||
      !text(body.clientId) ||
      !text(body.clientSecret) ||
      !/^[A-Za-z0-9._~-]{43,128}$/.test(text(body.codeVerifier)) ||
      redirect.pathname !== '/oauth/callback/teams' ||
      redirect.search ||
      redirect.hash ||
      redirect.username ||
      redirect.password ||
      (redirect.protocol !== 'https:' &&
        !(
          redirect.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(redirect.hostname)
        ))
    ) {
      throw new Error('Invalid OAuth request.');
    }
  } catch {
    return res
      .status(400)
      .json({ error: 'Invalid Microsoft Teams OAuth request.' });
  }
  try {
    const tokens = await exchange(
      tenantId,
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: text(body.clientId),
        client_secret: text(body.clientSecret),
        code: text(body.code),
        code_verifier: text(body.codeVerifier),
        redirect_uri: text(body.redirectUri),
        scope: teamsScopes,
      }),
    );
    if (!tokens.refreshToken) throw new Error('Missing offline access.');
    await store.save('integration', 'teams', {
      provider: 'teams',
      config: { authMode: 'oauth', tenantId },
      secrets: {
        clientId: text(body.clientId),
        clientSecret: text(body.clientSecret),
        ...tokens,
      },
    });
    return res.json({ connected: true });
  } catch {
    return res.status(400).json({
      error:
        'Unable to connect Microsoft Teams. Check app credentials, redirect URL, and delegated permissions, then try again.',
    });
  }
});

async function listResources(store: IntegrationCredentialStore, path: string) {
  await refreshTeamsCredentials(store);
  const connection = await store.resolve('integration', 'teams');
  const accessToken = text(connection?.secrets.accessToken);
  if (!accessToken) throw new Error('Not connected.');
  const base = new URL(baseUrl('graph'));
  let next: string | undefined = `${base.origin}/v1.0${path}`;
  const resources: Array<{ id: string; name: string }> = [];
  const seen = new Set<string>();
  while (next) {
    const url: URL = new URL(next);
    if (
      url.origin !== base.origin ||
      !url.pathname.startsWith('/v1.0/') ||
      url.username ||
      url.password ||
      seen.has(next) ||
      seen.size >= 100
    ) {
      throw new Error('Invalid Microsoft Graph pagination.');
    }
    seen.add(next);
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.value))
      throw new Error('Microsoft Graph request failed.');
    for (const item of data.value) {
      if (text(item?.id) && text(item?.displayName) && !item.isArchived) {
        resources.push({ id: item.id, name: item.displayName });
      }
    }
    next = text(data['@odata.nextLink']) || undefined;
  }
  return resources;
}

for (const route of ['/teams', '/teams/:teamId/channels']) {
  teamsRouter.get(route, async (req, res) => {
    const store = getIntegrationCredentialStore(req);
    if (!store || !(await store.resolve('integration', 'teams'))) {
      return res
        .status(401)
        .json({ error: 'Microsoft Teams is not connected.' });
    }
    try {
      const teamId = text(req.params.teamId);
      const resources = await listResources(
        store,
        teamId
          ? `/teams/${encodeURIComponent(teamId)}/channels?$select=id,displayName`
          : '/me/joinedTeams',
      );
      return res.json(teamId ? { channels: resources } : { teams: resources });
    } catch {
      return res.status(502).json({
        error:
          'Unable to load Microsoft Teams channels or teams. Check permissions or reconnect your account.',
      });
    }
  });
}

export const teamsApiContribution = {
  id: 'teams',
  // /api/teams belongs to Playrunner's own team management API.
  mountPath: '/api/microsoft-teams',
  router: teamsRouter,
  prepareCredentials: refreshTeamsCredentials,
} satisfies IntegrationApiContribution;

export default teamsApiContribution;
