import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  authenticationDeviceSignatureMessage,
  companionAppUrl,
  supportedCliVersion,
  usesAuthenticationCompanion,
  validateAuthenticationStorageState,
  verifyAuthenticationDeviceSignature,
} from './authentication-companion';

test('remote installations use companions and loopback retains direct capture', () => {
  const old = process.env.PLAYRUNNER_AUTHENTICATION_MODE;
  delete process.env.PLAYRUNNER_AUTHENTICATION_MODE;
  try {
    for (const hostname of ['localhost', '127.0.0.1', '[::1]', '::1']) {
      assert.equal(usesAuthenticationCompanion({ hostname }), false);
    }
    assert.equal(
      usesAuthenticationCompanion({ hostname: 'playrunner.easytest.lat' }),
      true,
    );
    process.env.PLAYRUNNER_AUTHENTICATION_MODE = 'companion';
    assert.equal(usesAuthenticationCompanion({ hostname: 'localhost' }), true);
  } finally {
    if (old === undefined) delete process.env.PLAYRUNNER_AUTHENTICATION_MODE;
    else process.env.PLAYRUNNER_AUTHENTICATION_MODE = old;
  }
});

test('approval uses HTTPS on a public host behind a proxy', () => {
  assert.equal(
    companionAppUrl({ get: () => 'playrunner.easytest.lat', protocol: 'http' }),
    'https://playrunner.easytest.lat',
  );
});

test('device signatures bind the method, complete path, body and nonce', () => {
  const keys = crypto.generateKeyPairSync('ed25519');
  const data = {
    method: 'POST',
    originalUrl: '/api/auth-companion/sessions/one/state',
    body: '{"state":{}}',
    timestamp: new Date().toISOString(),
    nonce: 'unique',
  };
  const message = authenticationDeviceSignatureMessage(data);
  const signature = crypto
    .sign(null, Buffer.from(message), keys.privateKey)
    .toString('base64');
  assert.equal(
    verifyAuthenticationDeviceSignature({
      message,
      publicKey: keys.publicKey,
      signature,
    }),
    true,
  );
  for (const changed of [
    { body: '{}' },
    { nonce: 'replayed' },
    { originalUrl: '/api/auth-companion/sessions/two/state' },
  ]) {
    assert.equal(
      verifyAuthenticationDeviceSignature({
        message: authenticationDeviceSignatureMessage({ ...data, ...changed }),
        publicKey: keys.publicKey,
        signature,
      }),
      false,
    );
  }
  assert.equal(
    validateAuthenticationStorageState({ cookies: [], origins: [] }),
    true,
  );
  assert.equal(
    validateAuthenticationStorageState({ cookies: [{}], origins: [] }),
    false,
  );
});

test('requires the CLI release that captures restored browser origins', () => {
  assert.equal(supportedCliVersion('0.2.4'), false);
  assert.equal(supportedCliVersion('0.2.5'), false);
  assert.equal(supportedCliVersion('0.2.6'), true);
  assert.equal(supportedCliVersion('0.3.0'), true);
});
