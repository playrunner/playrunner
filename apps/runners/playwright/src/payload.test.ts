import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  MAX_PLAYWRIGHT_PAYLOAD_BYTES,
  readPlaywrightExecutionEnvironment,
  readPlaywrightPayload,
} from './payload';

test('removes the credential-bearing PAYLOAD before child processes run', async () => {
  const environment = {
    PAYLOAD: JSON.stringify({
      data: { executionAuthToken: 'execution-secret' },
      settings: { gcp: { accessToken: 'gcp-secret' } },
    }),
  };

  const payload = await readPlaywrightPayload({ environment });

  assert.equal(payload.data.executionAuthToken, 'execution-secret');
  assert.equal(environment.PAYLOAD, undefined);
});

test('reads bounded local payloads from stdin', async () => {
  const payload = await readPlaywrightPayload({
    environment: {},
    input: Readable.from([JSON.stringify({ data: { testId: 'test-1' } })]),
  });
  assert.equal(payload.data.testId, 'test-1');
});

test('rejects oversized stdin payloads', async () => {
  await assert.rejects(
    () =>
      readPlaywrightPayload({
        environment: {},
        input: Readable.from([
          JSON.stringify({ value: 'x'.repeat(MAX_PLAYWRIGHT_PAYLOAD_BYTES) }),
        ]),
      }),
    /payload exceeds/,
  );
});

test('selects bounded environment values for repository processes', () => {
  assert.deepEqual(
    readPlaywrightExecutionEnvironment({
      data: { environment: { API_BASE_URL: 'https://example.test' } },
    }),
    { API_BASE_URL: 'https://example.test' },
  );
});

test('rejects runner-control environment overrides', () => {
  assert.throws(
    () =>
      readPlaywrightExecutionEnvironment({
        data: { environment: { PUBSUB_EMULATOR_HOST: 'attacker.test' } },
      }),
    /reserved/,
  );
  assert.throws(
    () =>
      readPlaywrightExecutionEnvironment({
        data: { environment: { NODE_OPTIONS: '--require=attacker.js' } },
      }),
    /reserved/,
  );
});
