import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseOrchestratorBootstrap,
  runOrchestratorJob,
} from './orchestrator-job';
import { ORCHESTRATOR_BOOTSTRAP_HEADER } from '../../../shared/orchestrator-bootstrap';

const bootstrap = {
  apiUrl: 'https://playrunner.cloud',
  executionId: 'execution_123',
  token: 'a'.repeat(43),
};

test('parses a bounded credential-free job bootstrap', () => {
  assert.deepEqual(
    parseOrchestratorBootstrap(JSON.stringify(bootstrap)),
    bootstrap,
  );
  assert.equal(parseOrchestratorBootstrap(undefined), null);
  assert.throws(
    () =>
      parseOrchestratorBootstrap(
        JSON.stringify({ ...bootstrap, apiUrl: 'https://user:pass@test/' }),
      ),
    /API URL is invalid/,
  );
});

test('claims the encrypted payload and executes it once', async () => {
  let executed: Record<string, unknown> | undefined;
  await runOrchestratorJob({
    bootstrap,
    execute: async (payload) => {
      executed = payload;
    },
    fetchImpl: (async (input, init) => {
      assert.equal(
        String(input),
        'https://playrunner.cloud/api/outputs/execution_123/orchestrator-payload',
      );
      assert.equal(init?.method, 'POST');
      assert.deepEqual(init?.headers, {
        [ORCHESTRATOR_BOOTSTRAP_HEADER]: bootstrap.token,
      });
      assert.equal(init?.body, undefined);
      return new Response(
        JSON.stringify({ payload: { testId: bootstrap.executionId } }),
        { status: 200 },
      );
    }) as typeof fetch,
  });
  assert.deepEqual(executed, { testId: bootstrap.executionId });
});

test('refuses a payload for a different execution', async () => {
  await assert.rejects(
    runOrchestratorJob({
      bootstrap,
      execute: async () => undefined,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ payload: { testId: 'other' } }), {
          status: 200,
        })) as typeof fetch,
    }),
    /payload response was invalid/,
  );
});
