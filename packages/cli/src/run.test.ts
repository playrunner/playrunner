import assert from 'node:assert/strict';
import test from 'node:test';
import { runCli } from './run.js';

const BASE_SHA = '1'.repeat(40);
const HEAD_SHA = '2'.repeat(40);

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', ...headers },
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
        PLAYRUNNER_BASE_REF: 'main',
        PLAYRUNNER_BASE_SHA: BASE_SHA,
        PLAYRUNNER_EVENT_TYPE: 'push',
        PLAYRUNNER_HEAD_REF: 'feature/checkout',
        PLAYRUNNER_HEAD_SHA: HEAD_SHA,
        PLAYRUNNER_REPOSITORY: 'playrunner/example',
        PLAYRUNNER_URL: 'https://playrunner.test',
      } as NodeJS.ProcessEnv,
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

test('--version reports the package version', async () => {
  const run = harness([]);

  assert.equal(await runCli(['--version'], run.dependencies), 0);
  assert.deepEqual(run.stdout, ['0.2.3']);
});

test('passes workflow inputs and acceptance criteria to the start request', async () => {
  const run = harness([
    jsonResponse({ executionId: 'execution-inputs', status: 'running' }, 202),
  ]);
  assert.equal(
    await runCli(
      [
        'workflow-1',
        '--no-wait',
        '--input',
        'ticket=46',
        '--acceptance-criteria',
        'Ticket #46 is the acceptance criteria',
      ],
      run.dependencies,
    ),
    0,
  );
  const body = JSON.parse(String(run.calls[0].init?.body));
  assert.deepEqual(body.inputs, { ticket: '46' });
  assert.deepEqual(body.acceptanceCriteria, [
    'Ticket #46 is the acceptance criteria',
  ]);
});

test('starts a saved workflow without repeating its repository configuration', async () => {
  const run = harness([
    jsonResponse({ executionId: 'execution-manual', status: 'running' }, 202),
  ]);
  run.dependencies.env = {
    PLAYRUNNER_API_KEY: 'pr_live_super-secret',
    PLAYRUNNER_URL: 'https://playrunner.test',
  };

  assert.equal(await runCli(['workflow-1', '--no-wait'], run.dependencies), 0);
  assert.deepEqual(JSON.parse(String(run.calls[0].init?.body)), {});
});

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
  assert.deepEqual(JSON.parse(String(run.calls[0].init?.body)), {
    baseRef: 'main',
    baseSha: BASE_SHA,
    eventType: 'push',
    headRef: 'feature/checkout',
    headSha: HEAD_SHA,
    repository: { name: 'example', owner: 'playrunner' },
  });
  assert.doesNotMatch(
    `${run.stdout.join('\n')}\n${run.stderr.join('\n')}`,
    /super-secret/,
  );
});

test('drains queued event pages before honoring a terminal status', async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    message: `Queued event ${index + 1}`,
    sequence: String(index + 1),
    type: 'log',
  }));
  const botPullRequestUrl = 'https://github.com/playrunner/example/pull/42';
  const run = harness([
    jsonResponse({ executionId: 'execution-paginated' }, 202),
    jsonResponse({ events: firstPage }),
    jsonResponse({
      events: [
        {
          baseRef: 'feature/checkout',
          draft: true,
          headRef: 'playrunner/tests/aaaaaaaaaaaa-bbbbbbbbbbbbbbbb',
          message: `Generated-test PR #42 (created): ${botPullRequestUrl}`,
          number: 42,
          repository: 'playrunner/example',
          sequence: '101',
          status: 'created',
          type: 'bot_pull_request',
          url: botPullRequestUrl,
        },
      ],
    }),
    jsonResponse({ status: 'completed' }),
  ]);

  assert.equal(await runCli(['workflow-1', '--json'], run.dependencies), 0);
  assert.equal(run.calls.length, 4);
  assert.match(run.calls[2].input, /events\?after=100$/);
  const tailEvent = JSON.parse(run.stdout[101]);
  const completion = JSON.parse(run.stdout[102]);
  assert.equal(tailEvent.type, 'bot_pull_request');
  assert.equal(tailEvent.draft, true);
  assert.equal(
    tailEvent.message,
    `Generated-test PR #42 (created): ${botPullRequestUrl}`,
  );
  assert.equal(tailEvent.sequence, '101');
  assert.equal(tailEvent.url, botPullRequestUrl);
  assert.equal(completion.status, 'completed');
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

test('accepts an explicit pull-request change context', async () => {
  const run = harness([jsonResponse({ executionId: 'execution-pr' }, 202)]);
  run.dependencies.env = {
    PLAYRUNNER_API_KEY: 'pr_live_super-secret',
    PLAYRUNNER_URL: 'https://playrunner.test',
  };

  assert.equal(
    await runCli(
      [
        'workflow-1',
        '--no-wait',
        '--repository',
        'playrunner/example',
        '--base-sha',
        BASE_SHA,
        '--head-sha',
        HEAD_SHA,
        '--base-ref',
        'main',
        '--head-ref',
        'feature/checkout',
        '--event-type',
        'pull_request',
        '--pull-request',
        '42',
      ],
      run.dependencies,
    ),
    0,
  );
  assert.deepEqual(JSON.parse(String(run.calls[0].init?.body)), {
    baseRef: 'main',
    baseSha: BASE_SHA,
    eventType: 'pull_request',
    headRef: 'feature/checkout',
    headSha: HEAD_SHA,
    pullRequestNumber: 42,
    repository: { name: 'example', owner: 'playrunner' },
  });
});

test('requires a pull-request number for pull-request events', async () => {
  const run = harness([]);
  run.dependencies.env = {
    PLAYRUNNER_API_KEY: 'pr_live_super-secret',
    PLAYRUNNER_BASE_REF: 'main',
    PLAYRUNNER_BASE_SHA: BASE_SHA,
    PLAYRUNNER_EVENT_TYPE: 'pull_request',
    PLAYRUNNER_HEAD_REF: 'feature/checkout',
    PLAYRUNNER_HEAD_SHA: HEAD_SHA,
    PLAYRUNNER_REPOSITORY: 'playrunner/example',
    PLAYRUNNER_URL: 'https://playrunner.test',
  };

  assert.equal(await runCli(['workflow-1'], run.dependencies), 2);
  assert.equal(run.calls.length, 0);
  assert.match(run.stderr[0], /Pull request events require/);
});

test('rejects a pull-request number for non-PR events', async () => {
  const run = harness([]);
  run.dependencies.env.PLAYRUNNER_PULL_REQUEST_NUMBER = '42';

  assert.equal(await runCli(['workflow-1'], run.dependencies), 2);
  assert.equal(run.calls.length, 0);
  assert.match(run.stderr[0], /only valid.*pull_request/);
});

test('requires a complete immutable CI change context when any part is supplied', async () => {
  const run = harness([]);
  run.dependencies.env = {
    PLAYRUNNER_API_KEY: 'pr_live_super-secret',
    PLAYRUNNER_REPOSITORY: 'playrunner/example',
    PLAYRUNNER_URL: 'https://playrunner.test',
  };

  assert.equal(await runCli(['workflow-1'], run.dependencies), 2);
  assert.equal(run.calls.length, 0);
  assert.match(run.stderr[0], /complete base commit SHA/);
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

test('honors Retry-After and resumes polling after a rate limit', async () => {
  const run = harness([
    jsonResponse({ executionId: 'execution-rate-limited' }, 202),
    jsonResponse({ error: 'Too many requests.' }, 429, { 'Retry-After': '3' }),
    jsonResponse({ events: [] }),
    jsonResponse({ status: 'completed' }),
  ]);
  let now = 0;
  const waits: number[] = [];

  const exitCode = await runCli(['workflow-1'], {
    ...run.dependencies,
    now: () => now,
    wait: async (milliseconds) => {
      waits.push(milliseconds);
      now += milliseconds;
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(waits, [3000]);
  assert.equal(run.calls.length, 4);
  assert.doesNotMatch(run.stderr.join('\n'), /Too many requests/);
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
      PLAYRUNNER_BASE_REF: 'main',
      PLAYRUNNER_BASE_SHA: BASE_SHA,
      PLAYRUNNER_HEAD_REF: 'feature/checkout',
      PLAYRUNNER_HEAD_SHA: HEAD_SHA,
      PLAYRUNNER_REPOSITORY: 'playrunner/example',
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
