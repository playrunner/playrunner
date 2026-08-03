import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IntegrationCredentialStore } from '@playrunner/integration-sdk/api';
import { refreshResendCredentials } from './index';

test('refreshes OAuth credentials and preserves a rotating refresh token', async () => {
  const patches: Record<string, unknown>[] = [];
  const store: IntegrationCredentialStore = {
    async resolve() {
      return {
        provider: 'resend',
        config: { authMode: 'oauth' },
        secrets: {
          clientId: 'client-id',
          clientSecret: 'client-secret',
          refreshToken: 'refresh-old',
          expiresAt: 0,
        },
      };
    },
    async save() {},
    async updateSecrets(_kind, _provider, patch) {
      patches.push(patch);
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    assert.match(
      String((init?.headers as Record<string, string>).Authorization),
      /^Basic /,
    );
    return Response.json({
      access_token: 'access-new',
      refresh_token: 'refresh-new',
      expires_in: 900,
      scope: 'full_access',
    });
  };
  try {
    await refreshResendCredentials(store);
    assert.equal(patches.length, 1);
    assert.equal(patches[0].accessToken, 'access-new');
    assert.equal(patches[0].refreshToken, 'refresh-new');
    assert.equal(patches[0].scope, 'full_access');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not refresh API-key connections', async () => {
  let fetched = false;
  const store: IntegrationCredentialStore = {
    async resolve() {
      return {
        provider: 'resend',
        config: { authMode: 'apiKey' },
        secrets: { apiKey: 're_test' },
      };
    },
    async save() {},
    async updateSecrets() {},
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetched = true;
    return Response.json({});
  };
  try {
    await refreshResendCredentials(store);
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
