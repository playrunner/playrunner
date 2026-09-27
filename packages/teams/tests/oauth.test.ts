import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import {
  createTeamsAuthorization,
  isTeamsCallback,
} from '../src/frontend/oauth.ts';
test('creates unique state and PKCE S256 challenge with minimal delegated scopes', async () => {
  const input = {
    tenantId: 'tenant',
    clientId: 'app',
    redirectUri: 'http://localhost/oauth/callback/teams',
  };
  const first = await createTeamsAuthorization(input);
  const second = await createTeamsAuthorization(input);
  const url = new URL(first.url);
  assert.notEqual(first.state, second.state);
  assert.notEqual(first.verifier, second.verifier);
  assert.equal(
    url.searchParams.get('code_challenge'),
    createHash('sha256').update(first.verifier).digest('base64url'),
  );
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('state'), first.state);
  assert.match(url.searchParams.get('scope')!, /offline_access/);
  assert.doesNotMatch(first.url, /client_secret|code_verifier/);
});
test('accepts only the expected popup, origin, and state', () => {
  const popup = {} as Window;
  const event = {
    origin: 'http://localhost',
    source: popup,
    data: { type: 'oauth_callback', params: { state: 'expected' } },
  } as unknown as MessageEvent;
  assert.equal(
    isTeamsCallback(event, popup, 'expected', 'http://localhost'),
    true,
  );
  for (const patch of [
    { origin: 'https://evil.test' },
    { source: {} },
    { data: { type: 'oauth_callback', params: { state: 'wrong' } } },
  ]) {
    assert.equal(
      isTeamsCallback(
        { ...event, ...patch } as MessageEvent,
        popup,
        'expected',
        'http://localhost',
      ),
      false,
    );
  }
});
