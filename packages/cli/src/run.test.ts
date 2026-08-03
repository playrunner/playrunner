import assert from 'node:assert/strict';
import test from 'node:test';
import { runCli } from './run.js';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

function harness(responses: Response[]) {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    calls,
    stderr,
    stdout,
    dependencies: {
      env: {
        PLAYRUNNER_API_KEY: 'pr_live_super-secret',
        PLAYRUNNER_URL: 'https://playrunner.test',
      },
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ input: String(input), init });
        const response = responses.shift();
        if (!response) throw new Error('Unexpected request');
        return response;
      },
      stderr: (line: string) => stderr.push(line),
      stdout: (line: string) => stdout.push(line),
      wait: async () => undefined,
    },
  };
}

test('waits for success, streams safe messages, and authenticates by header', async () => {
  const run = harness([
    jsonResponse({ executionId: 'execution-1', status: 'running' }, 202),
    jsonResponse({
      events: [
        {
          sequence: '1',
          type: 'log',
          message: 'Running checkout with pr_live_super-secret',
        },
      ],
    }),
    jsonResponse({ executionId: 'execution-1', status: 'completed' }),
  ]);

  const exitCode = await runCli(['workflow-1'], run.dependencies);

  assert.equal(exitCode, 0);
  assert.match(run.stdout.join('\n'), /Running checkout with \[redacted\]/);
  assert.equal(
    (run.calls[0].init?.headers as Record<string, string>).Authorization,
    'Bearer pr_live_super-secret',
  );
  assert.doesNotMatch(
    `${run.stdout.join('\n')}\n${run.stderr.join('\n')}`,
    /super-secret/,
  );
});

test('returns a gating failure code for a failed workflow', async () => {
  const run = harness([
    jsonResponse({ executionId: 'execution-2' }, 202),
    jsonResponse({ events: [] }),
    jsonResponse({ status: 'failed' }),
  ]);

  assert.equal(await runCli(['workflow-1'], run.dependencies), 1);
});

test('--no-wait returns after the accepted response', async () => {
  const run = harness([jsonResponse({ executionId: 'execution-3' }, 202)]);

  assert.equal(await runCli(['workflow-1', '--no-wait'], run.dependencies), 0);
  assert.equal(run.calls.length, 1);
  assert.match(run.stdout[0], /execution-3/);
});

test('returns a distinct timeout code', async () => {
  const run = harness([
    jsonResponse({ executionId: 'execution-4' }, 202),
    jsonResponse({ events: [] }),
    jsonResponse({ status: 'running' }),
  ]);
  let now = 0;
  const dependencies = {
    ...run.dependencies,
    now: () => now,
    wait: async () => {
      now = 1001;
    },
  };

  assert.equal(
    await runCli(['workflow-1', '--timeout', '1s'], dependencies),
    124,
  );
});

test('reports authentication failures without exposing the API key', async () => {
  const run = harness([jsonResponse({ error: 'Unauthorized' }, 401)]);

  assert.equal(await runCli(['workflow-1'], run.dependencies), 2);
  assert.deepEqual(run.stderr, ['Unauthorized']);
  assert.doesNotMatch(run.stderr.join('\n'), /super-secret/);
});

test('--json emits machine-readable lifecycle records', async () => {
  const run = harness([
    jsonResponse({ executionId: 'execution-5' }, 202),
    jsonResponse({ events: [] }),
    jsonResponse({ status: 'completed' }),
  ]);

  assert.equal(await runCli(['workflow-1', '--json'], run.dependencies), 0);
  assert.equal(JSON.parse(run.stdout[0]).type, 'started');
  assert.equal(JSON.parse(run.stdout[1]).status, 'completed');
});

test('--json emits machine-readable errors', async () => {
  const run = harness([jsonResponse({ error: 'Unauthorized' }, 401)]);

  assert.equal(await runCli(['workflow-1', '--json'], run.dependencies), 2);
  assert.deepEqual(JSON.parse(run.stderr[0]), {
    type: 'error',
    message: 'Unauthorized',
  });
});

test('returns a network error code', async () => {
  const stderr: string[] = [];
  const exitCode = await runCli(['workflow-1'], {
    env: {
      PLAYRUNNER_API_KEY: 'pr_live_secret',
      PLAYRUNNER_URL: 'https://playrunner.test',
    },
    fetch: async () => {
      throw new Error('network unavailable');
    },
    stderr: (line) => stderr.push(line),
  });

  assert.equal(exitCode, 2);
  assert.match(stderr[0], /network unavailable/);
  assert.doesNotMatch(stderr[0], /pr_live_secret/);
});
