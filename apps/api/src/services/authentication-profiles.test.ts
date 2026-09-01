import assert from 'node:assert/strict';
import test from 'node:test';
import {
  knownStorageStateExpiry,
  normalizeAuthenticationStartUrl,
  normalizeSuccessCondition,
  serializeAuthenticationProfile,
  type PlaywrightStorageState,
} from './authentication-profiles';

test('accepts only credential-free HTTP(S) authentication URLs', () => {
  assert.equal(
    normalizeAuthenticationStartUrl('https://example.test/login#form'),
    'https://example.test/login',
  );
  assert.throws(
    () => normalizeAuthenticationStartUrl('file:///tmp/session'),
    /credential-free HTTP\(S\)/,
  );
  assert.throws(
    () => normalizeAuthenticationStartUrl('https://user:pass@example.test'),
    /credential-free HTTP\(S\)/,
  );
});

test('normalizes bounded URL and element success conditions', () => {
  assert.deepEqual(
    normalizeSuccessCondition({
      type: 'url_prefix',
      value: 'https://example.test/app',
    }),
    { type: 'url_prefix', value: 'https://example.test/app' },
  );
  assert.deepEqual(
    normalizeSuccessCondition({
      type: 'element_visible',
      value: '[data-testid="account-menu"]',
    }),
    {
      type: 'element_visible',
      value: '[data-testid="account-menu"]',
    },
  );
  assert.throws(
    () => normalizeSuccessCondition({ type: 'javascript', value: 'true' }),
    /type is invalid/,
  );
});

test('uses the earliest future cookie expiry and ignores session cookies', () => {
  const now = Date.UTC(2030, 0, 1);
  const state = {
    cookies: [
      { expires: -1 },
      { expires: now / 1_000 + 3_600 },
      { expires: now / 1_000 + 600 },
    ],
    origins: [],
  } as PlaywrightStorageState;
  assert.equal(
    knownStorageStateExpiry(state, now)?.toISOString(),
    new Date(now + 600_000).toISOString(),
  );
});

test('public profile serialization never exposes encrypted browser state', () => {
  const serialized = serializeAuthenticationProfile({
    applicationLabel: null,
    authenticatedAt: new Date('2030-01-01T00:00:00Z'),
    authenticationMethod: 'local_agent',
    createdAt: new Date('2030-01-01T00:00:00Z'),
    encryptedState: 'ciphertext-secret',
    encryptionVersion: 1,
    environmentId: 'environment-1',
    expiresAt: null,
    id: 'profile-1',
    name: 'Staging Admin',
    ownerUserId: 'user-1',
    revokedAt: null,
    roleLabel: 'Admin',
    startUrl: 'https://example.test/login',
    status: 'authenticated',
    successConditionType: 'url_prefix',
    successConditionValue: 'https://example.test/app',
    updatedAt: new Date('2030-01-01T00:00:00Z'),
  });

  assert.equal(serialized.credentialStatus.configured, true);
  assert.equal(JSON.stringify(serialized).includes('ciphertext-secret'), false);
  assert.equal('encryptedState' in serialized, false);
});
