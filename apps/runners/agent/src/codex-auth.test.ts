import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCodexEnvironment,
  createCredentialFreeEnvironment,
} from './codex-auth';

test('maps the selected Playrunner Environment value to CODEX_API_KEY', () => {
  const environment = createCodexEnvironment(
    { apiKeyEnvVar: 'OPENAI_API_KEY' },
    { OPENAI_API_KEY: 'secret-value', UNRELATED: 'preserved' },
  );

  assert.equal(environment.CODEX_API_KEY, 'secret-value');
  assert.equal(environment.OPENAI_API_KEY, undefined);
  assert.equal(environment.UNRELATED, 'preserved');
});

test('removes every Codex credential from repository-controlled commands', () => {
  const environment = createCredentialFreeEnvironment(
    { apiKeyEnvVar: 'MODEL_SECRET' },
    {
      CODEX_ACCESS_TOKEN: 'access-token',
      CODEX_API_KEY: 'codex-key',
      MODEL_SECRET: 'selected-key',
      OPENAI_API_KEY: 'openai-key',
      PLAYRUNNER_AGENT_BOOTSTRAP: 'bootstrap-secret',
      TEST_LOGIN: 'preserved',
    },
  );

  assert.deepEqual(environment, { TEST_LOGIN: 'preserved' });
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
