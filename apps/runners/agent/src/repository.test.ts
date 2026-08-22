import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { AgentRunnerPayload } from './payload';
import type { ProcessResult } from './process';
import {
  classifyChangedPath,
  cloneRepository,
  createChangeManifest,
  createGitEnvironment,
  getAgentIdentity,
  MAX_CHANGED_FILES,
  MAX_CHANGED_LINES,
  prepareRepository,
} from './repository';

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);

function processResult(
  stdout = '',
  overrides: Partial<ProcessResult> = {},
): ProcessResult {
  return {
    code: 0,
    durationMs: 1,
    signal: null,
    stderr: '',
    stdout,
    timedOut: false,
    ...overrides,
  };
}

function ciPayload(): AgentRunnerPayload {
  return {
    agent: { nodeId: 'codex-agent', nodeType: 'codex-cli' },
    changeContext: {
      baseRef: 'main',
      baseSha: BASE_SHA,
      eventType: 'pull_request',
      headRef: 'feature/coverage',
      headSha: HEAD_SHA,
      pullRequestNumber: 42,
      repository: 'playrunner/example',
    },
    config: {
      folder: 'tests/e2e',
      repository: 'playrunner/example.git',
    },
    environment: {},
    github: { accessToken: 'top-secret' },
    runtime: {
      cloudProvider: 'LOCAL_RUNNER',
      editorApiUrl: 'http://editor.test',
      executionAuthToken: 'execution-token',
      nodeId: 'agent-node',
      testId: 'execution-1',
      workflowId: 'workflow-1',
    },
    runnerControl: {
      controlSubscriptionName: 'agent-control',
      projectId: 'test-project',
      protocolToken: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      topicName: 'workflow-events',
      type: 'gcp_pubsub',
    },
    validators: [{ nodeId: 'test-validator', nodeType: 'validator' }],
  };
}

function pushChangeContext(): NonNullable<AgentRunnerPayload['changeContext']> {
  return {
    baseRef: 'main',
    baseSha: BASE_SHA,
    eventType: 'push',
    headRef: 'feature/coverage',
    headSha: HEAD_SHA,
    repository: 'playrunner/example',
  };
}

test('puts GitHub authentication in the child environment, not the URL', () => {
  const identity = { gid: 1001, home: '/home/playrunner', uid: 1001 };
  const environment = createGitEnvironment('top-secret', identity, {
    PATH: '/bin',
  });
  assert.equal(environment.GIT_CONFIG_COUNT, '1');
  assert.equal(
    environment.GIT_CONFIG_KEY_0,
    'http.https://github.com/.extraheader',
  );
  assert.match(environment.GIT_CONFIG_VALUE_0 || '', /^Authorization: Basic /);
  assert.doesNotMatch(environment.GIT_CONFIG_VALUE_0 || '', /top-secret/);
  assert.equal(environment.HOME, '/home/playrunner');
});

test('removes inherited inline Git config from credential-free commands', () => {
  const environment = createGitEnvironment(
    undefined,
    { gid: 1001, home: '/home/playrunner', uid: 1001 },
    {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_PARAMETERS: "'credential.helper'='attacker'",
      GIT_CONFIG_VALUE_0: 'Authorization: secret',
    },
  );
  assert.equal(environment.GIT_CONFIG_COUNT, undefined);
  assert.equal(environment.GIT_CONFIG_KEY_0, undefined);
  assert.equal(environment.GIT_CONFIG_PARAMETERS, undefined);
  assert.equal(environment.GIT_CONFIG_VALUE_0, undefined);
});

test('normalizes the unprivileged container identity', () => {
  assert.deepEqual(
    getAgentIdentity({
      PLAYRUNNER_AGENT_GID: '2002',
      PLAYRUNNER_AGENT_HOME: '/agent-home',
      PLAYRUNNER_AGENT_UID: '2001',
    }),
    { gid: 2002, home: '/agent-home', uid: 2001 },
  );
});

test('clones a fixed GitHub URL without putting credentials in argv', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-clone-'));
  const repositoryRoot = path.join(root, 'repo');
  const identity = {
    gid: process.getgid?.() || 1001,
    home: root,
    uid: process.getuid?.() || 1001,
  };
  const payload: AgentRunnerPayload = {
    agent: { nodeId: 'codex-agent', nodeType: 'codex-cli' },
    config: {
      branch: 'feature/coverage',
      folder: 'tests/e2e',
      repository: 'playrunner/example.git',
    },
    environment: {},
    github: { accessToken: 'top-secret' },
    runtime: {
      cloudProvider: 'LOCAL_RUNNER',
      editorApiUrl: 'http://editor.test',
      executionAuthToken: 'execution-token',
      nodeId: 'agent-node',
      testId: 'execution-1',
      workflowId: 'workflow-1',
    },
    runnerControl: {
      controlSubscriptionName: 'agent-control',
      projectId: 'test-project',
      protocolToken: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      topicName: 'workflow-events',
      type: 'gcp_pubsub',
    },
    validators: [{ nodeId: 'test-validator', nodeType: 'validator' }],
  };
  try {
    const cwd = await cloneRepository(payload, {
      identity,
      repositoryRoot,
      runCommand: async (command, args, options) => {
        assert.equal(command, 'git');
        assert.ok(args.includes('https://github.com/playrunner/example.git'));
        assert.doesNotMatch(args.join(' '), /top-secret|x-access-token/);
        assert.match(
          options?.env?.GIT_CONFIG_VALUE_0 || '',
          /^Authorization: Basic /,
        );
        fs.mkdirSync(path.join(repositoryRoot, 'tests/e2e'), {
          recursive: true,
        });
        return {
          code: 0,
          durationMs: 1,
          signal: null,
          stderr: '',
          stdout: '',
          timedOut: false,
        };
      },
    });
    assert.equal(cwd, path.join(repositoryRoot, 'tests/e2e'));
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('rejects a configured folder that escapes the repository through a symlink', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-clone-escape-'));
  const repositoryRoot = path.join(root, 'repo');
  const externalDirectory = path.join(root, 'external');
  const identity = {
    gid: process.getgid?.() || 1001,
    home: root,
    uid: process.getuid?.() || 1001,
  };
  const payload: AgentRunnerPayload = {
    agent: { nodeId: 'codex-agent', nodeType: 'codex-cli' },
    config: {
      branch: 'main',
      folder: 'escaped',
      repository: 'playrunner/example',
    },
    environment: {},
    runtime: {
      cloudProvider: 'LOCAL_RUNNER',
      editorApiUrl: 'http://editor.test',
      executionAuthToken: 'execution-token',
      nodeId: 'agent-node',
      testId: 'execution-1',
      workflowId: 'workflow-1',
    },
    runnerControl: {
      controlSubscriptionName: 'agent-control',
      projectId: 'test-project',
      protocolToken: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      topicName: 'workflow-events',
      type: 'gcp_pubsub',
    },
    validators: [{ nodeId: 'test-validator', nodeType: 'validator' }],
  };

  try {
    fs.mkdirSync(externalDirectory);
    await assert.rejects(
      () =>
        cloneRepository(payload, {
          identity,
          repositoryRoot,
          runCommand: async () => {
            fs.symlinkSync(
              externalDirectory,
              path.join(repositoryRoot, 'escaped'),
              'dir',
            );
            return {
              code: 0,
              durationMs: 1,
              signal: null,
              stderr: '',
              stdout: '',
              timedOut: false,
            };
          },
        }),
      /must resolve to a directory inside the repository/,
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('rejects a clone that times out even if the child reports exit code 0', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-clone-timeout-'));
  const repositoryRoot = path.join(root, 'repo');
  const identity = {
    gid: process.getgid?.() || 1001,
    home: root,
    uid: process.getuid?.() || 1001,
  };
  const payload = {
    agent: { nodeId: 'codex-agent', nodeType: 'codex-cli' },
    config: { repository: 'playrunner/example' },
    environment: {},
    runnerControl: {
      controlSubscriptionName: 'agent-control',
      projectId: 'test-project',
      protocolToken: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      topicName: 'workflow-events',
      type: 'gcp_pubsub' as const,
    },
    runtime: {
      cloudProvider: 'LOCAL_RUNNER',
      editorApiUrl: 'http://editor.test',
      executionAuthToken: 'execution-token',
      nodeId: 'agent-node',
      testId: 'execution-1',
      workflowId: 'workflow-1',
    },
    validators: [{ nodeId: 'test-validator', nodeType: 'validator' }],
  };

  try {
    await assert.rejects(
      cloneRepository(payload, {
        identity,
        repositoryRoot,
        runCommand: async () => ({
          code: 0,
          durationMs: 1,
          signal: null,
          stderr: '',
          stdout: '',
          timedOut: true,
        }),
      }),
      /Git clone timed out/,
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('classifies production, test, and configuration paths deterministically', () => {
  assert.equal(classifyChangedPath('src/checkout.ts'), 'production');
  assert.equal(classifyChangedPath('src/checkout.test.ts'), 'test');
  assert.equal(classifyChangedPath('tests/e2e/checkout.spec.ts'), 'test');
  assert.equal(classifyChangedPath('.github/workflows/ci.yml'), 'config');
  assert.equal(classifyChangedPath('playwright.config.ts'), 'config');
  assert.equal(classifyChangedPath('db/migrations/001.sql'), 'production');
});

test('creates a bounded deterministic manifest with inclusive head line ranges', async () => {
  const names = [
    'M',
    'src/z.ts',
    'A',
    'tests/z.test.ts',
    'M',
    'playwright.config.ts',
    'R095',
    'src/old.ts',
    'src/new.ts',
    'D',
    'src/deleted.ts',
    '',
  ].join('\0');
  const patches: Record<string, string> = {
    'playwright.config.ts': '@@ -1 +1 @@\n-old\n+new\n',
    'src/deleted.ts': '@@ -5,2 +5,0 @@\n-old\n-old\n',
    'src/new.ts': '@@ -20 +20,2 @@\n-old\n+new\n+newer\n',
    'src/z.ts': '@@ -4 +4 @@\n-old\n+new\n@@ -10,0 +11,2 @@\n+one\n+two\n',
    'tests/z.test.ts': '@@ -0,0 +1,5 @@\n+1\n+2\n+3\n+4\n+5\n',
  };
  const manifest = await createChangeManifest(
    '/tmp/change-manifest-repository',
    pushChangeContext(),
    {
      identity: { gid: 1, home: '/tmp', uid: 1 },
      runCommand: async (_command, args) => {
        if (args.includes('--name-status')) return processResult(names);
        const literalPath = args.at(-1) || '';
        const changedPath = literalPath.replace(/^:\(literal\)/, '');
        return processResult(patches[changedPath]);
      },
    },
  );

  assert.deepEqual(
    manifest.files.map((file) => file.path),
    [
      'playwright.config.ts',
      'src/deleted.ts',
      'src/new.ts',
      'src/z.ts',
      'tests/z.test.ts',
    ],
  );
  assert.deepEqual(
    manifest.files.find((file) => file.path === 'src/z.ts')?.changedLines,
    [
      { end: 4, start: 4 },
      { end: 12, start: 11 },
    ],
  );
  assert.deepEqual(
    manifest.files.find((file) => file.path === 'src/deleted.ts')?.changedLines,
    [],
  );
  assert.deepEqual(
    manifest.files.find((file) => file.path === 'src/new.ts'),
    {
      binary: false,
      changedLineCount: 2,
      changedLines: [{ end: 21, start: 20 }],
      classification: 'production',
      path: 'src/new.ts',
      previousPath: 'src/old.ts',
      status: 'renamed',
    },
  );
  assert.deepEqual(manifest.summary, {
    changedFiles: 5,
    changedLines: 11,
    configChangedLines: 1,
    configFiles: 1,
    productionChangedLines: 5,
    productionFiles: 3,
    testChangedLines: 5,
    testFiles: 1,
  });
});

test('reads real Git NUL status and hunk output for committed changes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-real-diff-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  try {
    git('init', '--quiet');
    git('config', 'user.email', 'agent@example.test');
    git('config', 'user.name', 'Agent Test');
    fs.mkdirSync(path.join(root, 'src'));
    fs.mkdirSync(path.join(root, 'tests'));
    fs.writeFileSync(
      path.join(root, 'src', 'checkout.ts'),
      'export function checkout(total: number) {\n  return total;\n}\n',
    );
    git('add', '.');
    git('commit', '--quiet', '-m', 'base');
    const baseSha = git('rev-parse', 'HEAD');
    fs.writeFileSync(
      path.join(root, 'src', 'checkout.ts'),
      [
        'export function checkout(total: number) {',
        "  if (total < 0) throw new Error('invalid total');",
        '  return total;',
        '}',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(root, 'tests', 'checkout.test.ts'),
      "test('rejects invalid total', () => expect(() => checkout(-1)).toThrow());\n",
    );
    git('add', '.');
    git('commit', '--quiet', '-m', 'head');
    const headSha = git('rev-parse', 'HEAD');

    const manifest = await createChangeManifest(
      root,
      {
        baseRef: 'main',
        baseSha,
        eventType: 'push',
        headRef: 'feature/checkout',
        headSha,
        repository: 'playrunner/example',
      },
      {
        identity: {
          gid: process.getgid?.() || 1001,
          home: root,
          uid: process.getuid?.() || 1001,
        },
      },
    );
    assert.deepEqual(
      manifest.files.map((file) => [
        file.path,
        file.classification,
        file.status,
      ]),
      [
        ['src/checkout.ts', 'production', 'modified'],
        ['tests/checkout.test.ts', 'test', 'added'],
      ],
    );
    assert.ok(manifest.summary.productionChangedLines > 0);
    assert.ok(manifest.summary.testChangedLines > 0);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('uses the merge base for divergent pull request manifests while push and manual keep the explicit range', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pr-diff-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const identity = {
    gid: process.getgid?.() || 1001,
    home: root,
    uid: process.getuid?.() || 1001,
  };
  try {
    git('init', '--quiet');
    git('config', 'user.email', 'agent@example.test');
    git('config', 'user.name', 'Agent Test');
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'shared.ts'), 'export {}\n');
    git('add', '.');
    git('commit', '--quiet', '-m', 'common ancestor');
    const commonAncestor = git('rev-parse', 'HEAD');

    git('checkout', '--quiet', '-b', 'feature/coverage');
    fs.writeFileSync(
      path.join(root, 'src', 'feature.ts'),
      'export const feature = true;\n',
    );
    git('add', '.');
    git('commit', '--quiet', '-m', 'feature change');
    const headSha = git('rev-parse', 'HEAD');

    git('checkout', '--quiet', '-b', 'main', commonAncestor);
    fs.writeFileSync(
      path.join(root, 'src', 'base-only.ts'),
      'export const baseOnly = true;\n',
    );
    git('add', '.');
    git('commit', '--quiet', '-m', 'base branch change');
    const baseSha = git('rev-parse', 'HEAD');

    const pullRequestManifest = await createChangeManifest(
      root,
      {
        baseRef: 'main',
        baseSha,
        eventType: 'pull_request',
        headRef: 'feature/coverage',
        headSha,
        pullRequestNumber: 42,
        repository: 'playrunner/example',
      },
      { identity },
    );
    assert.deepEqual(
      pullRequestManifest.files.map((file) => [file.path, file.status]),
      [['src/feature.ts', 'added']],
    );

    for (const eventType of ['push', 'manual'] as const) {
      const explicitRangeManifest = await createChangeManifest(
        root,
        {
          baseRef: 'main',
          baseSha,
          eventType,
          headRef: 'feature/coverage',
          headSha,
          repository: 'playrunner/example',
        },
        { identity },
      );
      assert.deepEqual(
        explicitRangeManifest.files.map((file) => [file.path, file.status]),
        [
          ['src/base-only.ts', 'deleted'],
          ['src/feature.ts', 'added'],
        ],
      );
    }
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('fails closed on unavailable, malformed, or ambiguous pull request merge bases', async () => {
  const mergeBase = 'c'.repeat(40);
  const cases = [
    {
      expected: /merge-base resolution failed with code 1/,
      result: processResult('', { code: 1 }),
    },
    {
      expected: /could not resolve a pull request merge base/,
      result: processResult(''),
    },
    {
      expected: /malformed pull request merge base/,
      result: processResult('not-an-object\n'),
    },
    {
      expected: /ambiguous pull request merge bases/,
      result: processResult(`${mergeBase}\n${'d'.repeat(40)}\n`),
    },
  ];

  for (const testCase of cases) {
    await assert.rejects(
      () =>
        createChangeManifest(
          '/tmp/change-manifest-repository',
          ciPayload().changeContext!,
          {
            identity: { gid: 1, home: '/tmp', uid: 1 },
            runCommand: async (_command, args) =>
              args[0] === 'merge-base' && args[1] === '--all'
                ? testCase.result
                : processResult(),
          },
        ),
      testCase.expected,
    );
  }
});

test('fails closed when a pull request merge base is not verified as an ancestor', async () => {
  const mergeBase = 'c'.repeat(40);
  await assert.rejects(
    () =>
      createChangeManifest(
        '/tmp/change-manifest-repository',
        ciPayload().changeContext!,
        {
          identity: { gid: 1, home: '/tmp', uid: 1 },
          runCommand: async (_command, args) => {
            if (args[0] !== 'merge-base') return processResult();
            if (args[1] === '--all') return processResult(`${mergeBase}\n`);
            return processResult('', { code: 1 });
          },
        },
      ),
    /merge-base base ancestry verification failed with code 1/,
  );
});

test('fails closed when changed-file output is truncated or contains an unsafe path', async () => {
  const context = pushChangeContext();
  await assert.rejects(
    () =>
      createChangeManifest('/tmp/change-manifest-repository', context, {
        identity: { gid: 1, home: '/tmp', uid: 1 },
        runCommand: async () =>
          processResult('M\0src/value.ts\0', { stdoutTruncated: true }),
      }),
    /truncated Git output/,
  );
  await assert.rejects(
    () =>
      createChangeManifest('/tmp/change-manifest-repository', context, {
        identity: { gid: 1, home: '/tmp', uid: 1 },
        runCommand: async () => processResult('M\0../outside.ts\0'),
      }),
    /unsafe changed repository path/,
  );
});

test('fails closed when manifest file or changed-line bounds are exceeded', async () => {
  const context = pushChangeContext();
  const tooManyFiles = `${Array.from(
    { length: MAX_CHANGED_FILES + 1 },
    (_, index) => `M\0src/file-${index}.ts\0`,
  ).join('')}`;
  await assert.rejects(
    () =>
      createChangeManifest('/tmp/change-manifest-repository', context, {
        identity: { gid: 1, home: '/tmp', uid: 1 },
        runCommand: async () => processResult(tooManyFiles),
      }),
    /changed-file limit/,
  );
  await assert.rejects(
    () =>
      createChangeManifest('/tmp/change-manifest-repository', context, {
        identity: { gid: 1, home: '/tmp', uid: 1 },
        runCommand: async (_command, args) =>
          args.includes('--name-status')
            ? processResult('M\0src/value.ts\0')
            : processResult(`@@ -0,0 +1,${MAX_CHANGED_LINES + 1} @@\n`),
      }),
    /changed-line limit/,
  );
});

test('fails closed on malformed changed-line hunks', async () => {
  await assert.rejects(
    () =>
      createChangeManifest(
        '/tmp/change-manifest-repository',
        pushChangeContext(),
        {
          identity: { gid: 1, home: '/tmp', uid: 1 },
          runCommand: async (_command, args) =>
            args.includes('--name-status')
              ? processResult('M\0src/value.ts\0')
              : processResult('@@ malformed @@\n'),
        },
      ),
    /malformed changed-line hunk/,
  );
});

test('prepares CI repositories at exact commits and never substitutes branch heads', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-ci-clone-'));
  const repositoryRoot = path.join(root, 'repo');
  const payload = ciPayload();
  const calls: string[][] = [];
  const identity = {
    gid: process.getgid?.() || 1001,
    home: root,
    uid: process.getuid?.() || 1001,
  };
  try {
    const prepared = await prepareRepository(payload, {
      identity,
      repositoryRoot,
      runCommand: async (command, args, options) => {
        assert.equal(command, 'git');
        calls.push(args);
        assert.doesNotMatch(args.join(' '), /top-secret|x-access-token/);
        if (args[0] === 'clone' || args[0] === 'fetch') {
          assert.match(
            options?.env?.GIT_CONFIG_VALUE_0 || '',
            /^Authorization: Basic /,
          );
        } else {
          assert.equal(options?.env?.GIT_CONFIG_VALUE_0, undefined);
        }
        if (args[0] === 'merge-base') {
          assert.equal(options?.maxOutputBytes, 4_096);
        }
        if (args[0] === 'clone') {
          assert.ok(args.includes('--no-checkout'));
          assert.ok(args.includes('--depth'));
          assert.ok(args.includes('https://github.com/playrunner/example.git'));
          fs.mkdirSync(path.join(repositoryRoot, 'tests/e2e'), {
            recursive: true,
          });
        }
        if (args[0] === 'rev-parse') return processResult(`${HEAD_SHA}\n`);
        if (args[0] === 'merge-base' && args[1] === '--all') {
          return processResult(`${BASE_SHA}\n`);
        }
        if (args.includes('--name-status')) return processResult('');
        return processResult();
      },
    });
    assert.equal(prepared.headRevision, HEAD_SHA);
    assert.equal(
      prepared.workingDirectory,
      path.join(repositoryRoot, 'tests/e2e'),
    );
    assert.deepEqual(
      calls.filter((args) => args[0] === 'fetch').map((args) => args.at(-1)),
      [HEAD_SHA, BASE_SHA],
    );
    assert.ok(
      calls
        .filter((args) => args[0] === 'fetch')
        .every((args) => args[args.indexOf('--depth') + 1] === '10000'),
    );
    assert.deepEqual(
      calls.find((args) => args[0] === 'merge-base' && args[1] === '--all'),
      ['merge-base', '--all', BASE_SHA, HEAD_SHA],
    );
    assert.ok(
      calls.some(
        (args) =>
          args[0] === 'checkout' &&
          args.includes('--detach') &&
          args.at(-1) === HEAD_SHA,
      ),
    );
    assert.equal(prepared.changeManifest?.summary.changedFiles, 0);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('pins trusted push contexts to the credentialed configured source branch', async () => {
  const cases = [
    { output: '', pattern: /resolve exactly one configured source branch/ },
    {
      output: `${HEAD_SHA}\trefs/heads/other\n`,
      pattern: /invalid configured source branch/,
    },
    {
      output: `${HEAD_SHA}\trefs/heads/feature/coverage\n${HEAD_SHA}\trefs/heads/feature/coverage\n`,
      pattern: /resolve exactly one configured source branch/,
    },
    {
      output: `${'c'.repeat(40)}\trefs/heads/feature/coverage\n`,
      pattern: /does not resolve to changeContext\.headSha/,
    },
  ];

  for (const [index, testCase] of cases.entries()) {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), `agent-push-pin-${index}-`),
    );
    const repositoryRoot = path.join(root, 'repo');
    const payload = ciPayload();
    payload.changeContext = pushChangeContext();
    try {
      await assert.rejects(
        prepareRepository(payload, {
          identity: {
            gid: process.getgid?.() || 1001,
            home: root,
            uid: process.getuid?.() || 1001,
          },
          repositoryRoot,
          runCommand: async (_command, args, options) => {
            if (args[0] === 'clone') {
              fs.mkdirSync(path.join(repositoryRoot, 'tests/e2e'), {
                recursive: true,
              });
            }
            if (args[0] === 'rev-parse') return processResult(`${HEAD_SHA}\n`);
            if (args.includes('--name-status')) return processResult('');
            if (args[0] === 'ls-remote') {
              assert.deepEqual(args, [
                'ls-remote',
                '--heads',
                'origin',
                'refs/heads/feature/coverage',
              ]);
              assert.match(
                options?.env?.GIT_CONFIG_VALUE_0 || '',
                /^Authorization: Basic /,
              );
              return processResult(testCase.output);
            }
            return processResult();
          },
        }),
        testCase.pattern,
      );
    } finally {
      fs.rmSync(root, { force: true, recursive: true });
    }
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-push-pin-ok-'));
  const repositoryRoot = path.join(root, 'repo');
  const payload = ciPayload();
  payload.changeContext = pushChangeContext();
  try {
    const prepared = await prepareRepository(payload, {
      identity: {
        gid: process.getgid?.() || 1001,
        home: root,
        uid: process.getuid?.() || 1001,
      },
      repositoryRoot,
      runCommand: async (_command, args) => {
        if (args[0] === 'clone') {
          fs.mkdirSync(path.join(repositoryRoot, 'tests/e2e'), {
            recursive: true,
          });
        }
        if (args[0] === 'rev-parse') return processResult(`${HEAD_SHA}\n`);
        if (args.includes('--name-status')) return processResult('');
        if (args[0] === 'ls-remote') {
          return processResult(`${HEAD_SHA}\trefs/heads/feature/coverage\n`);
        }
        return processResult();
      },
    });
    assert.equal(prepared.headRevision, HEAD_SHA);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('rejects mismatched CI repositories before cloning', async () => {
  const value = ciPayload();
  value.changeContext!.repository = 'another/repository';
  let invoked = false;
  await assert.rejects(
    () =>
      prepareRepository(value, {
        repositoryRoot: path.join(os.tmpdir(), 'agent-mismatch-repository'),
        runCommand: async () => {
          invoked = true;
          return processResult();
        },
      }),
    /does not match config\.repository/,
  );
  assert.equal(invoked, false);
});

test('rejects a checkout that does not resolve to the requested head SHA', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-wrong-head-'));
  const repositoryRoot = path.join(root, 'repo');
  const identity = {
    gid: process.getgid?.() || 1001,
    home: root,
    uid: process.getuid?.() || 1001,
  };
  try {
    await assert.rejects(
      () =>
        prepareRepository(ciPayload(), {
          identity,
          repositoryRoot,
          runCommand: async (_command, args) => {
            if (args[0] === 'clone')
              fs.mkdirSync(repositoryRoot, { recursive: true });
            if (args[0] === 'rev-parse') {
              return processResult(`${'c'.repeat(40)}\n`);
            }
            return processResult();
          },
        }),
      /different commit than changeContext\.headSha/,
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});
