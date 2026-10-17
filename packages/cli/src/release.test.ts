import assert from 'node:assert/strict';
import test from 'node:test';
import { runCli, type CliDependencies } from './run.js';

const NOW = Date.parse('2026-10-17T10:00:00.000Z');
const POLICY = 'a'.repeat(64);
const CANDIDATE = {
  repository: 'Playrunner/example',
  commitSha: 'b'.repeat(40),
  artifactDigest: `sha256:${'c'.repeat(64)}`,
  environment: 'staging',
  targetUrl: 'https://preview.example/release',
};
const REQUIREMENT = {
  id: 'LOGIN-1',
  status: 'PASS',
  reason: 'All explicitly mapped tests passed.',
  evidence: [
    { nodeId: 'browser', kind: 'test', evidenceId: 'test-1', status: 'PASS' },
  ],
};
const IDENTITY = {
  ...REQUIREMENT,
  id: 'RELEASE_IDENTITY',
  evidence: [
    { nodeId: 'identity', kind: 'node', evidenceId: '', status: 'PASS' },
  ],
};
function verdict(patch: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    status: 'PASS',
    allowed: true,
    workflowId: 'workflow-1',
    executionId: 'execution-1',
    candidate: CANDIDATE,
    policyVersion: POLICY,
    criteriaVersion: 'd'.repeat(64),
    completedAt: new Date(NOW - 60_000).toISOString(),
    expiresAt: new Date(NOW + 3_540_000).toISOString(),
    reasons: [],
    requirements: [IDENTITY, REQUIREMENT],
    ...patch,
  };
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function args(action = 'check', extra: string[] = []) {
  return [
    'release',
    action,
    'workflow-1',
    ...(action === 'check' ? ['--execution', 'execution-1'] : []),
    '--candidate',
    'candidate.json',
    '--policy-version',
    POLICY,
    ...extra,
  ];
}
function harness(responses: Array<Response | Error>) {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  let time = NOW;
  const dependencies: CliDependencies = {
    env: {
      PLAYRUNNER_API_KEY: 'pr_live_secret',
      PLAYRUNNER_URL: 'https://playrunner.test/base',
      GITHUB_REPOSITORY: 'unrelated/checkout',
      GITHUB_EVENT_NAME: 'push',
      GITHUB_SHA: 'e'.repeat(40),
      PLAYRUNNER_BASE_SHA: 'f'.repeat(40),
    },
    readFile: async () => JSON.stringify(CANDIDATE),
    now: () => time,
    wait: async (ms, signal) => {
      signal.throwIfAborted();
      time += ms;
    },
    fetch: async (input, init) => {
      calls.push({ input: String(input), init });
      const response = responses.shift();
      if (!response) throw new Error('Unexpected request');
      if (response instanceof Error) throw response;
      return response;
    },
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  };
  return { calls, stdout, stderr, dependencies };
}

test('policy discovery returns reviewed versions without starting a workflow', async () => {
  const policy = {
    workflowId: 'workflow-1',
    policyVersion: POLICY,
    criteriaVersion: 'd'.repeat(64),
    requirements: [{ id: 'RELEASE_IDENTITY' }, { id: 'LOGIN-1' }],
  };
  const run = harness([json(policy)]);
  assert.equal(
    await runCli(
      ['release', 'policy', 'workflow-1', '--json'],
      run.dependencies,
    ),
    0,
  );
  assert.match(
    run.calls[0].input,
    /\/base\/api\/v1\/workflows\/workflow-1\/release-policy$/,
  );
  assert.equal(run.calls[0].init?.method, undefined);
  assert.equal(JSON.parse(run.stdout[0]).policyVersion, POLICY);
});

test('verify starts once with release binding and no inherited CI change context, then gates on evidence', async () => {
  const run = harness([
    json({ executionId: 'execution-1', workflowId: 'workflow-1' }, 202),
    json({ status: 'running' }),
    json({ status: 'completed' }),
    json(verdict()),
  ]);
  assert.equal(await runCli(args('verify', ['--json']), run.dependencies), 0);
  assert.deepEqual(JSON.parse(String(run.calls[0].init?.body)), {
    release: {
      candidate: CANDIDATE,
      policyVersion: POLICY,
      maxAgeSeconds: 3600,
    },
  });
  const headers = run.calls[0].init?.headers as Record<string, string>;
  assert.match(headers['Idempotency-Key'], /^[0-9a-f-]{36}$/);
  assert.equal(headers.Authorization, 'Bearer pr_live_secret');
  assert.equal(run.calls[0].init?.redirect, 'error');
  assert.equal(run.calls.length, 4);
  assert.equal(JSON.parse(run.stdout.at(-1)!).allowed, true);
});

test('check requests a fresh verdict without starting or trusting lifecycle completion', async () => {
  const run = harness([json(verdict())]);
  assert.equal(await runCli(args('check', ['--json']), run.dependencies), 0);
  assert.equal(run.calls.length, 1);
  assert.match(run.calls[0].input, /executions\/execution-1\/release-verdict$/);
  assert.equal(run.calls[0].init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(run.calls[0].init?.body)), {
    candidate: CANDIDATE,
    policyVersion: POLICY,
    maxAgeSeconds: 3600,
  });
});

test('FAIL and BLOCKED verdicts block release with exit 1', async () => {
  for (const status of ['FAIL', 'BLOCKED']) {
    const run = harness([
      json(
        verdict({
          status,
          allowed: false,
          completedAt: null,
          expiresAt: null,
          criteriaVersion: null,
          requirements: [],
          reasons: [
            { code: 'missing_evidence', message: 'Required result missing.' },
          ],
        }),
      ),
    ]);
    assert.equal(await runCli(args(), run.dependencies), 1);
    assert.match(run.stdout[0], new RegExp(`Release ${status}`));
  }
});

test('completed workflow without a verdict cannot approve a release', async () => {
  const run = harness([
    json({ executionId: 'execution-1' }, 202),
    json({ status: 'completed' }),
    json({ status: 'completed' }),
  ]);
  assert.equal(await runCli(args('verify'), run.dependencies), 2);
  assert.doesNotMatch(run.stdout.join('\n'), /Release PASS/);
});

test('candidate and execution identity mismatches never return success', async () => {
  const candidates = CANDIDATE;
  const patches = [
    { workflowId: 'other-workflow' },
    { executionId: 'other-execution' },
    { policyVersion: 'f'.repeat(64) },
    ...Object.keys(candidates).map((key) => ({
      candidate: {
        ...candidates,
        [key]: {
          repository: 'other/repo',
          commitSha: 'f'.repeat(40),
          artifactDigest: `sha256:${'f'.repeat(64)}`,
          environment: 'production',
          targetUrl: 'https://other.example',
        }[key],
      },
    })),
  ];
  for (const patch of patches) {
    const run = harness([json(verdict(patch))]);
    assert.equal(await runCli(args(), run.dependencies), 2);
    assert.doesNotMatch(run.stdout.join('\n'), /Release PASS/);
  }
});

test('untrusted PASS payloads must satisfy schema, coverage, and evidence', async () => {
  const patches = [
    { schemaVersion: 2 },
    { status: 'completed' },
    { allowed: 'true' },
    { status: 'BLOCKED', allowed: true },
    { criteriaVersion: 'unknown' },
    { criteriaVersion: ['d'.repeat(64)] },
    { reasons: null },
    { reasons: [{ code: 'warning', message: 'Needs review.' }] },
    { requirements: [] },
    { requirements: [IDENTITY] },
    { requirements: [REQUIREMENT] },
    { requirements: [IDENTITY, REQUIREMENT, REQUIREMENT] },
    { requirements: [IDENTITY, { ...REQUIREMENT, status: 'SKIPPED' }] },
    { requirements: [IDENTITY, { ...REQUIREMENT, evidence: [] }] },
    {
      requirements: [
        IDENTITY,
        {
          ...REQUIREMENT,
          evidence: [{ ...REQUIREMENT.evidence[0], status: 'FAIL' }],
        },
      ],
    },
    {
      requirements: [
        IDENTITY,
        {
          ...REQUIREMENT,
          evidence: [{ ...REQUIREMENT.evidence[0], evidenceId: '' }],
        },
      ],
    },
    {
      requirements: [
        IDENTITY,
        {
          ...REQUIREMENT,
          evidence: [{ ...REQUIREMENT.evidence[0], kind: 'unknown' }],
        },
      ],
    },
    { candidate: { ...CANDIDATE, extra: 'untrusted' } },
  ];
  for (const patch of patches) {
    const run = harness([json(verdict(patch))]);
    assert.equal(
      await runCli(args(), run.dependencies),
      2,
      JSON.stringify(patch),
    );
    assert.equal(run.stdout.length, 0);
  }
});

test('stale, future, missing, invalid or overlong PASS validity cannot release', async () => {
  for (const patch of [
    { completedAt: null },
    { expiresAt: null },
    { completedAt: '2026-10-17T09:59:00' },
    { expiresAt: '2026-10-17T10:59:00' },
    { completedAt: 'invalid' },
    { completedAt: new Date(NOW + 1).toISOString() },
    { expiresAt: new Date(NOW).toISOString() },
    { completedAt: new Date(NOW - 3_600_001).toISOString() },
    { expiresAt: new Date(NOW + 3_600_000).toISOString() },
  ]) {
    const run = harness([json(verdict(patch))]);
    assert.equal(
      await runCli(args(), run.dependencies),
      2,
      JSON.stringify(patch),
    );
  }
});

test('requested stricter evidence age is forwarded and enforced locally', async () => {
  const run = harness([json(verdict())]);
  assert.equal(
    await runCli(args('check', ['--max-age', '30']), run.dependencies),
    2,
  );
  assert.equal(JSON.parse(String(run.calls[0].init?.body)).maxAgeSeconds, 30);
});

test('failed_to_start is terminal and cannot approve even a contradictory PASS', async () => {
  for (const result of [
    verdict({ status: 'BLOCKED', allowed: false }),
    verdict(),
  ]) {
    const run = harness([
      json({ executionId: 'execution-1' }, 202),
      json({ status: 'failed_to_start' }),
      json(result),
    ]);
    assert.equal(
      await runCli(args('verify'), run.dependencies),
      result.allowed ? 2 : 1,
    );
    assert.equal(run.calls.length, 3);
  }
});

test('unknown or mismatched polling status is blocked immediately', async () => {
  for (const status of [
    { status: 'unknown' },
    { status: 'completed', executionId: 'other' },
  ]) {
    const run = harness([
      json({ executionId: 'execution-1' }, 202),
      json(status),
    ]);
    assert.equal(await runCli(args('verify'), run.dependencies), 2);
    assert.equal(run.calls.length, 2);
  }
});

test('an ambiguous start is not retried and prints a recovery key without credentials', async () => {
  const run = harness([new Error('Network error pr_live_secret')]);
  assert.equal(await runCli(args('verify', ['--json']), run.dependencies), 2);
  assert.equal(run.calls.length, 1);
  assert.match(run.stderr[0], /Request key/);
  assert.doesNotMatch(run.stderr[0], /pr_live_secret/);
});

test('missing verdict, expired authorization, and malformed JSON fail closed', async () => {
  for (const response of [
    json({ error: 'Not found' }, 404),
    json({ error: 'Unauthorized pr_live_secret' }, 401),
    new Response('not json'),
    json(null),
  ]) {
    const run = harness([response]);
    assert.equal(await runCli(args(), run.dependencies), 2);
    assert.equal(run.stdout.length, 0);
    assert.doesNotMatch(run.stderr.join('\n'), /pr_live_secret/);
  }
});

test('bounded verification wait expires without starting a second run', async () => {
  const run = harness([
    json({ executionId: 'execution-1' }, 202),
    json({ status: 'running' }),
  ]);
  assert.equal(
    await runCli(args('verify', ['--timeout', '5ms']), run.dependencies),
    124,
  );
  assert.equal(run.calls.length, 2);
  assert.match(run.stderr[0], /may still be running/);
});

test('cancellation during polling stops waiting and never approves release', async () => {
  const run = harness([
    json({ executionId: 'execution-1' }, 202),
    json({ status: 'running' }),
  ]);
  const controller = new AbortController();
  run.dependencies.signal = controller.signal;
  run.dependencies.wait = async () => {
    controller.abort();
  };
  assert.equal(await runCli(args('verify'), run.dependencies), 130);
  assert.equal(run.calls.length, 2);
});

test('invalid candidate manifests fail before any network calls', async () => {
  for (const manifest of [
    { ...CANDIDATE, commitSha: 'B'.repeat(40) },
    { ...CANDIDATE, artifactDigest: 'latest' },
    { ...CANDIDATE, environment: '../prod' },
    { ...CANDIDATE, repository: 'repo' },
    ...[
      'https://user:password@example.com',
      'https://example.com?q=secret',
      'https://example.com#fragment',
      'file:///tmp/file',
      'https://example.com?',
    ].map((targetUrl) => ({ ...CANDIDATE, targetUrl })),
  ]) {
    const run = harness([]);
    run.dependencies.readFile = async () => JSON.stringify(manifest);
    assert.equal(await runCli(args(), run.dependencies), 2);
    assert.equal(run.calls.length, 0);
  }
});

test('unsafe or unsupported release options fail before any network calls', async () => {
  for (const extra of [
    ['--max-age', '0'],
    ['--max-age', '86401'],
    ['--max-age', '1.5'],
    ['--no-wait'],
    ['--input', 'MOCK_MODE=true'],
    ['--head-sha', 'b'.repeat(40)],
    ['--url', 'https://user:secret@example.com'],
  ]) {
    const run = harness([]);
    assert.equal(await runCli(args('verify', extra), run.dependencies), 2);
    assert.equal(run.calls.length, 0);
  }
});

test('release help is available without credentials', async () => {
  const run = harness([]);
  run.dependencies.env = {};
  assert.equal(await runCli(['release', '--help'], run.dependencies), 0);
  assert.match(run.stdout[0], /do not publish or deploy/);
  assert.equal(run.calls.length, 0);
});
