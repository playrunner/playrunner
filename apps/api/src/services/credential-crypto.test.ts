import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decryptCredentialSecrets,
  decryptSecretPayload,
  encryptCredentialSecrets,
  encryptSecretPayload,
  loadCredentialKeyring,
} from './credential-crypto';

const keyring = loadCredentialKeyring({
  PLAYRUNNER_CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({
    1: Buffer.alloc(32, 7).toString('base64'),
  }),
  PLAYRUNNER_CREDENTIAL_ENCRYPTION_KEY_VERSION: '1',
});

test('encrypts opaque profile state with purpose-bound associated data', () => {
  const state = {
    cookies: [{ name: 'session', value: 'browser-secret' }],
    origins: [],
  };
  const identityParts = [
    'user-1',
    'authentication_profile',
    'profile-1',
    'storage_state',
  ];
  const encrypted = encryptSecretPayload(state, identityParts, keyring);

  assert.equal(encrypted.encryptedValue.includes('browser-secret'), false);
  assert.deepEqual(
    decryptSecretPayload(
      encrypted.encryptedValue,
      encrypted.encryptionVersion,
      identityParts,
      keyring,
    ),
    state,
  );
  assert.throws(() =>
    decryptSecretPayload(
      encrypted.encryptedValue,
      encrypted.encryptionVersion,
      [...identityParts.slice(0, 2), 'profile-2', 'storage_state'],
      keyring,
    ),
  );
});

const identity = {
  userId: 'user-1',
  kind: 'integration',
  provider: 'openai',
};

test('encrypts and decrypts provider-specific secret fields', () => {
  const encrypted = encryptCredentialSecrets(
    { apiKey: 'sk-secret' },
    identity,
    keyring,
  );

  assert.equal(encrypted.encryptionVersion, 1);
  assert.equal(encrypted.encryptedSecrets.includes('sk-secret'), false);
  assert.deepEqual(
    decryptCredentialSecrets(
      encrypted.encryptedSecrets,
      encrypted.encryptionVersion,
      identity,
      keyring,
    ),
    { apiKey: 'sk-secret' },
  );
});

test('binds ciphertext to the user, kind, provider, and key version', () => {
  const encrypted = encryptCredentialSecrets(
    { accessToken: 'hf-secret' },
    { ...identity, provider: 'huggingface' },
    keyring,
  );

  assert.throws(() =>
    decryptCredentialSecrets(
      encrypted.encryptedSecrets,
      encrypted.encryptionVersion,
      identity,
      keyring,
    ),
  );
});

test('rejects malformed key configuration', () => {
  assert.throws(
    () =>
      loadCredentialKeyring({
        PLAYRUNNER_CREDENTIAL_ENCRYPTION_KEYS: '{"1":"too-short"}',
        PLAYRUNNER_CREDENTIAL_ENCRYPTION_KEY_VERSION: '1',
      }),
    /32 bytes/,
  );
});
