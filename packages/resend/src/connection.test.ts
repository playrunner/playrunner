import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createResendApiKeyIntegrationData } from './connection';

test('normalizes API-key connection data', () => {
  assert.deepEqual(
    createResendApiKeyIntegrationData(
      '  re_test  ',
      '  login@example.resend.app  ',
    ),
    {
      provider: 'resend',
      config: {
        authMode: 'apiKey',
        receivingAddress: 'login@example.resend.app',
      },
      secrets: { apiKey: 're_test' },
    },
  );
  assert.throws(
    () => createResendApiKeyIntegrationData('   '),
    /key is required/,
  );
});
