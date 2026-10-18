import assert from 'node:assert/strict';
import test from 'node:test';
import { runCli } from './run.js';

test('feedback resumes a known run through one GET, preserving cursor and nested redaction', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const stdout: string[] = [];
  const code = await runCli(
    ['feedback', 'workflow /', 'execution ?', '--after', '100', '--json'],
    {
      env: {
        PLAYRUNNER_URL: 'https://playrunner.example',
        PLAYRUNNER_API_KEY: 'pr_live_secret',
      },
      fetch: async (input, init) => {
        calls.push({ url: String(input), init });
        return new Response(
          JSON.stringify({
            status: 'completed',
            failures: [{ error: 'pr_live_secret' }],
            nextCursor: '101',
            hasMore: false,
          }),
        );
      },
      stdout: (line) => stdout.push(line),
    },
  );
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init?.method, 'GET');
  assert.equal(calls[0].init?.body, undefined);
  assert.match(
    calls[0].url,
    /workflow%20%2F\/executions\/execution%20%3F\/feedback\?after=100$/,
  );
  assert.equal(
    (calls[0].init?.headers as Record<string, string>).Authorization,
    'Bearer pr_live_secret',
  );
  assert.equal(JSON.parse(stdout[0]).failures[0].error, '[redacted]');
});

test('invalid feedback cursor and missing identifiers never make a request', async () => {
  for (const args of [
    ['feedback', 'w'],
    ['feedback', 'w', 'e', '--after', '-1'],
    ['feedback', 'w', 'e', '--after', '9223372036854775808'],
  ]) {
    let calls = 0;
    assert.equal(
      await runCli(args, {
        env: {
          PLAYRUNNER_URL: 'https://example.com',
          PLAYRUNNER_API_KEY: 'secret',
        },
        fetch: async () => {
          calls++;
          throw new Error('unexpected');
        },
        stderr: () => undefined,
      }),
      2,
    );
    assert.equal(calls, 0);
  }
});

test('feedback permission denial remains an error and cannot trigger a replacement run', async () => {
  let calls = 0;
  const errors: string[] = [];
  const code = await runCli(['feedback', 'w', 'e', '--json'], {
    env: {
      PLAYRUNNER_URL: 'https://example.com',
      PLAYRUNNER_API_KEY: 'secret',
    },
    fetch: async (_input, init) => {
      calls++;
      assert.equal(init?.method, 'GET');
      return new Response(
        JSON.stringify({ error: 'Workflow execution not found.' }),
        { status: 404 },
      );
    },
    stderr: (line) => errors.push(line),
  });
  assert.equal(code, 2);
  assert.equal(calls, 1);
  assert.equal(JSON.parse(errors[0]).message, 'Workflow execution not found.');
});
