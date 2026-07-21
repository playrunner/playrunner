import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHuggingFaceIntegrationData } from './connection';

test('normalizes stored Hugging Face integration data', () => {
  assert.deepEqual(createHuggingFaceIntegrationData('  hf_test_secret  '), {
    provider: 'huggingface',
    config: {},
    secrets: { accessToken: 'hf_test_secret' },
  });
  assert.throws(
    () => createHuggingFaceIntegrationData('   '),
    /access token is required/,
  );
});
