import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IntegrationCredentialStore } from '@playrunner/integration-sdk/api';
import { refreshGithubCredentials } from './index';

test('refreshes expiring credentials once for concurrent requests', async () => {
  const patches: Record<string, unknown>[] = [];
  const store: IntegrationCredentialStore = {
    async resolve() {
      return {
        provider: 'github',
        config: {},
        secrets: {
          accessToken: 'access-old',
          clientId: 'client-id',
          clientSecret: 'client-secret',
          expiresAt: 0,
          refreshToken: 'refresh-old',
        },
      };
    },
    async save() {},
    async updateSecrets(_kind, _provider, patch) {
      patches.push(patch);
    },
  };
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async (_input, init) => {
    fetches += 1;
    assert.equal(
      (init?.headers as Record<string, string>)['Content-Type'],
      'application/x-www-form-urlencoded',
    );
    assert.equal(
      String(init?.body),
      'client_id=client-id&client_secret=client-secret&refresh_token=refresh-old&grant_type=refresh_token',
    );
    await Promise.resolve();
    return Response.json({
      access_token: 'access-new',
      expires_in: 28_800,
      refresh_token: 'refresh-new',
      refresh_token_expires_in: 15_897_600,
    });
  };

  try {
    await Promise.all([
      refreshGithubCredentials(store),
      refreshGithubCredentials(store),
    ]);
    assert.equal(fetches, 1);
    assert.equal(patches.length, 1);
    assert.equal(patches[0].accessToken, 'access-new');
    assert.equal(patches[0].refreshToken, 'refresh-new');
    assert.equal(typeof patches[0].expiresAt, 'number');
    assert.equal(typeof patches[0].refreshTokenExpiresAt, 'number');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not refresh a GitHub credential before its refresh window', async () => {
  let fetched = false;
  const store: IntegrationCredentialStore = {
    async resolve() {
      return {
        provider: 'github',
        config: {},
        secrets: {
          accessToken: 'access-current',
          clientId: 'client-id',
          clientSecret: 'client-secret',
          expiresAt: Date.now() + 60 * 60 * 1000,
          refreshToken: 'refresh-current',
        },
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
    await refreshGithubCredentials(store);
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
