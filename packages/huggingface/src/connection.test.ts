import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHuggingFaceIntegrationData } from './connection';

test('normalizes stored Hugging Face integration data', () => {
  assert.deepEqual(
    createHuggingFaceIntegrationData(
      '  hf_test_secret  ',
      '2026-07-21T00:00:00Z',
    ),
    {
      accessToken: 'hf_test_secret',
      updatedAt: '2026-07-21T00:00:00Z',
    },
  );
  assert.throws(
    () => createHuggingFaceIntegrationData('   '),
    /access token is required/,
  );
});
