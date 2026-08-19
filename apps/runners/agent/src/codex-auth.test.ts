import assert from 'node:assert/strict';
import test from 'node:test';
import { createCodexEnvironment } from './codex-auth';

test('maps the selected Playrunner Environment value to CODEX_API_KEY', () => {
  const environment = createCodexEnvironment(
    { apiKeyEnvVar: 'OPENAI_API_KEY' },
    { OPENAI_API_KEY: 'secret-value', UNRELATED: 'preserved' },
  );

  assert.equal(environment.CODEX_API_KEY, 'secret-value');
  assert.equal(environment.UNRELATED, 'preserved');
});

test('rejects a missing or empty selected Environment value', () => {
  assert.throws(
    () =>
      createCodexEnvironment(
        { apiKeyEnvVar: 'OPENAI_API_KEY' },
        { OPENAI_API_KEY: '' },
      ),
    /OPENAI_API_KEY is missing or empty/,
  );
  assert.throws(
    () => createCodexEnvironment({}, {}),
    /\(not configured\) is missing or empty/,
  );
});
