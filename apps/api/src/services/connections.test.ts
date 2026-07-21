import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertConnectionConfigSafe } from './connections';

test('allows non-secret provider configuration', () => {
  assert.doesNotThrow(() =>
    assertConnectionConfigSafe({
      selectedProject: 'my-project',
      cloudRunLocation: 'australia-southeast1',
      runner: { maxInstances: 10 },
    }),
  );
});

test('rejects secret fields in public connection config', () => {
  for (const field of [
    'apiKey',
    'access_token',
    'clientSecret',
    'refreshToken',
    'webhookUrl',
  ]) {
    assert.throws(
      () => assertConnectionConfigSafe({ nested: { [field]: 'secret' } }),
      /must be stored in secrets/,
    );
  }
});
