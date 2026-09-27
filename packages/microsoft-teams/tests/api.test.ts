import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import express from 'express';
import type { Server } from 'node:http';
import { teamsRouter, refreshTeamsCredentials } from '../src/api/index.ts';
import type { IntegrationCredentialStore } from '@playrunner/integration-sdk/api';

const realFetch = globalThis.fetch;
let server: Server;
let base: string;
let connection: Awaited<ReturnType<IntegrationCredentialStore['resolve']>>;
const store: IntegrationCredentialStore = {
  async resolve(kind, provider) {
    assert.equal(kind, 'integration');
    assert.equal(provider, 'microsoft-teams');
    return connection;
  },
  async save(kind, provider, value) {
    assert.equal(kind, 'integration');
    assert.equal(provider, 'microsoft-teams');
    connection = {
      provider: 'microsoft-teams',
      config: value.config ?? {},
      secrets: value.secrets ?? {},
    };
  },
  async updateSecrets(kind, provider, patch) {
    assert.equal(kind, 'integration');
    assert.equal(provider, 'microsoft-teams');
    Object.assign(connection!.secrets, patch);
  },
};
const input = {
  tenantId: 'contoso.onmicrosoft.com',
  clientId: 'app',
  clientSecret: 'private-secret',
  code: 'private-code',
  codeVerifier: 'v'.repeat(43),
  redirectUri: 'http://localhost/oauth/callback/microsoft-teams',
};
function connected(expiresAt = Date.now() + 3600_000) {
  connection = {
    provider: 'microsoft-teams',
    config: { tenantId: input.tenantId },
    secrets: {
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      accessToken: 'private-access',
      refreshToken: 'private-refresh',
      expiresAt,
    },
  };
}
function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}
async function request(path: string, body?: unknown) {
  return realFetch(
    `${base}${path}`,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {},
  );
}
beforeEach(async () => {
  connection = null;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { integrationCredentials: store });
    next();
  });
  app.use(teamsRouter);
  server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}`;
  globalThis.fetch = async () => {
    throw new Error('Unexpected upstream request');
  };
});
afterEach(async () => {
  globalThis.fetch = realFetch;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

test('exchanges a PKCE code and persists secrets without returning them', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(
      String(url),
      'https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token',
    );
    const body = options!.body as URLSearchParams;
    assert.equal(body.get('code_verifier'), input.codeVerifier);
    assert.equal(body.get('client_secret'), input.clientSecret);
    assert.equal(body.get('redirect_uri'), input.redirectUri);
    assert.equal(options!.redirect, 'error');
    assert.match(body.get('scope')!, /ChannelMessage.Send/);
    return json({
      access_token: 'private-access',
      refresh_token: 'private-refresh',
      expires_in: 3600,
    });
  };
  const response = await request('/oauth-token', input);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { connected: true });
  assert.equal(connection?.secrets.accessToken, 'private-access');
  assert.deepEqual(connection?.config, {
    authMode: 'oauth',
    tenantId: input.tenantId,
  });
});

test('rejects invalid OAuth inputs before calling Microsoft', async () => {
  for (const patch of [
    { tenantId: '../common' },
    { codeVerifier: 'short' },
    { redirectUri: 'http://evil.test/oauth/callback/microsoft-teams' },
    { clientSecret: '' },
  ]) {
    assert.equal(
      (await request('/oauth-token', { ...input, ...patch })).status,
      400,
    );
    assert.equal(connection, null);
  }
});

test('sanitizes rejected and malformed token responses and preserves existing credentials', async () => {
  connected();
  for (const response of [
    json({ error_description: 'private-secret' }, 400),
    new Response('private-secret', { status: 502 }),
    json({ access_token: 'private-access', expires_in: 3600 }),
  ]) {
    globalThis.fetch = async () => response;
    const result = await request('/oauth-token', input);
    assert.equal(result.status, 400);
    assert.doesNotMatch(await result.text(), /private-/);
    assert.equal(connection?.secrets.refreshToken, 'private-refresh');
  }
});

test('refreshes expired tokens, preserves omitted refresh token, and uses fresh token for discovery', async () => {
  connected(0);
  let count = 0;
  globalThis.fetch = async (url, options) => {
    count++;
    if (String(url).includes('/token')) {
      assert.equal(
        (options!.body as URLSearchParams).get('grant_type'),
        'refresh_token',
      );
      return json({ access_token: 'new-access', expires_in: 3600 });
    }
    assert.equal(
      (options!.headers as Record<string, string>).Authorization,
      'Bearer new-access',
    );
    return json({ value: [{ id: 'team-1', displayName: 'Engineering' }] });
  };
  const result = await request('/teams');
  assert.equal(result.status, 200);
  assert.equal(count, 2);
  assert.equal(connection?.secrets.refreshToken, 'private-refresh');
  assert.deepEqual(await result.json(), {
    teams: [{ id: 'team-1', name: 'Engineering' }],
  });
});

test('rotates refresh tokens and leaves valid tokens alone', async () => {
  connected();
  await refreshTeamsCredentials(store);
  connected(0);
  globalThis.fetch = async () =>
    json({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 3600,
    });
  await refreshTeamsCredentials(store);
  assert.equal(connection?.secrets.refreshToken, 'new-refresh');
});

test('fails closed when refresh is rejected', async () => {
  connected(0);
  globalThis.fetch = async () => json({ error: 'private-refresh' }, 401);
  await assert.rejects(refreshTeamsCredentials(store), /Reconnect/);
  assert.equal((await request('/teams')).status, 502);
});

test('returns all discovery pages, encodes team paths, and excludes archived teams', async () => {
  connected();
  const urls: string[] = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return urls.length === 1
      ? json({
          value: [
            { id: '1', displayName: 'First' },
            { id: 'old', displayName: 'Archived', isArchived: true },
          ],
          '@odata.nextLink':
            'https://graph.microsoft.com/v1.0/teams/team%2Fid/channels?$skiptoken=2',
        })
      : json({ value: [{ id: '2', displayName: 'Second' }] });
  };
  const response = await request('/teams/team%2Fid/channels');
  assert.equal(response.status, 200);
  assert.ok(urls[0].includes('/teams/team%2Fid/channels'));
  assert.equal((await response.json()).channels.length, 2);
});

test('does not forward tokens to external pagination URLs or expose upstream errors', async () => {
  connected();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return json({
      value: [],
      '@odata.nextLink': 'https://evil.test/private-access',
    });
  };
  const response = await request('/teams');
  assert.equal(response.status, 502);
  assert.equal(calls, 1);
  assert.doesNotMatch(await response.text(), /private-access|evil/);
});

test('returns unauthorized when disconnected', async () => {
  assert.equal((await request('/teams')).status, 401);
});
