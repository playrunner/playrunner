import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOpenAIIntegrationData } from './connection';

test('normalizes the stored OpenAI integration data', () => {
  assert.deepEqual(
    createOpenAIIntegrationData('  sk-project-test  ', '2026-07-21T00:00:00Z'),
    {
      apiKey: 'sk-project-test',
      updatedAt: '2026-07-21T00:00:00Z',
    },
  );
  assert.throws(() => createOpenAIIntegrationData('   '), /key is required/);
});
