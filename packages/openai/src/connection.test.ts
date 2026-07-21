import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOpenAIIntegrationData } from './connection';

test('normalizes the stored OpenAI integration data', () => {
  assert.deepEqual(createOpenAIIntegrationData('  sk-project-test  '), {
    provider: 'openai',
    config: {},
    secrets: { apiKey: 'sk-project-test' },
  });
  assert.throws(() => createOpenAIIntegrationData('   '), /key is required/);
});
