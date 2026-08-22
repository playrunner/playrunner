import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  deliverBotPullRequest,
  MAX_BOT_PR_CHANGED_FILES,
  MAX_BOT_PR_FILE_BYTES,
  type BotPrDeliveryOptions,
} from './bot-pr';
import type { ProcessResult } from './process';

const DEVELOPER_SHA = 'a'.repeat(40);
const COMMIT_SHA = 'b'.repeat(40);
const REMOTE_SHA = 'c'.repeat(40);
const DEFAULT_BRANCH_SHA = 'd'.repeat(40);
const TOKEN = 'github-test-token';

function gitBlobObjectId(contents: Buffer): string {
  return crypto
    .createHash('sha1')
    .update(Buffer.from(`blob ${contents.length}\0`, 'utf8'))
    .update(contents)
    .digest('hex');
}

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

type CommandCall = {
  args: string[];
  command: string;
  options: NonNullable<
    Parameters<NonNullable<BotPrDeliveryOptions['runCommand']>>[2]
  >;
};

class FakeGit {
  readonly calls: CommandCall[] = [];
  readonly committedFiles = new Map<string, Buffer>();
  readonly stagedFiles = new Map<string, Buffer>();
  committed = false;
  credentialConfig?: {
    contents: string;
    mode: number;
    path: string;
    uid: number;
  };
  pushed = false;
  staged = false;

  constructor(
    readonly root: string,
    readonly statuses: Array<{ path: string; status?: string }>,
    readonly options: {
      baseFiles?: Record<string, string>;
      dangerousConfig?: string;
      developerWorkflowContents?: string;
      indexMode?: string;
      mutateOnAdd?: () => void;
      mutateIndexOnCommit?: (stagedFiles: Map<string, Buffer>) => void;
      onPush?: () => void;
      privilegedDeveloperWorkflow?: boolean;
      remoteDeveloperSha?: string;
      remoteDeveloperShaAfterPush?: string;
      remoteSha?: string;
      reportedHead?: string;
      timeoutOperation?: string;
    } = {},
  ) {}

  private statusOutput(): string {
    if (this.committed) return '';
    return this.statuses
      .map(({ path: filePath, status = '??' }) => {
        if (!this.staged) return `${status} ${filePath}\0`;
        return `${status === '??' ? 'A ' : 'M '} ${filePath}\0`;
      })
      .join('');
  }

  private subcommand(args: string[]): { index: number; value: string } {
    const commands = new Set([
      'add',
      'cat-file',
      'commit',
      'config',
      'diff',
      'diff-tree',
      'grep',
      'init',
      'ls-files',
      'ls-remote',
      'ls-tree',
      'push',
      'rev-parse',
      'show',
      'status',
      'switch',
    ]);
    const index = args.findIndex((value) => commands.has(value));
    assert.notEqual(index, -1, `Unexpected Git command: ${args.join(' ')}`);
    return { index, value: args[index] };
  }

  run: NonNullable<BotPrDeliveryOptions['runCommand']> = async (
    command,
    args,
    options,
  ) => {
    assert.ok(options);
    this.calls.push({ args, command, options });
    assert.equal(command, 'git');
    const subcommand = this.subcommand(args);
    if (this.options.timeoutOperation === subcommand.value) {
      return processResult('', { timedOut: true });
    }
    switch (subcommand.value) {
      case 'config':
        return this.options.dangerousConfig
          ? processResult(`${this.options.dangerousConfig}\n`)
          : processResult('', { code: 1 });
      case 'init':
      case 'cat-file':
        return processResult();
      case 'rev-parse': {
        const target = args[subcommand.index + 1];
        if (target === '--show-toplevel')
          return processResult(`${this.root}\n`);
        if (target === `${COMMIT_SHA}^`)
          return processResult(`${DEVELOPER_SHA}\n`);
        return processResult(
          `${
            this.committed
              ? COMMIT_SHA
              : this.options.reportedHead || DEVELOPER_SHA
          }\n`,
        );
      }
      case 'status':
        return processResult(this.statusOutput());
      case 'grep':
        return this.options.privilegedDeveloperWorkflow
          ? processResult('.github/workflows/ci.yml:3:  pull_request_target:\n')
          : processResult('', { code: 1 });
      case 'show': {
        const object = args[subcommand.index + 1];
        const filePath = object.slice(object.indexOf(':') + 1);
        const value = object.startsWith(':')
          ? this.stagedFiles.get(filePath)?.toString('utf8')
          : filePath === '.github/workflows/ci.yml' &&
              (this.options.developerWorkflowContents !== undefined ||
                this.options.privilegedDeveloperWorkflow)
            ? this.options.developerWorkflowContents ||
              'on:\n  pull_request_target:\njobs:\n  test:\n    runs-on: ubuntu-latest\n'
            : this.options.baseFiles?.[filePath];
        return value === undefined
          ? processResult('', { code: 128 })
          : processResult(value);
      }
      case 'switch':
        return processResult();
      case 'add':
        this.options.mutateOnAdd?.();
        for (const { path: filePath } of this.statuses) {
          this.stagedFiles.set(
            filePath,
            fs.readFileSync(path.join(this.root, filePath)),
          );
        }
        this.staged = true;
        return processResult();
      case 'diff':
        if (args.includes('--name-only')) {
          return processResult(
            this.statuses
              .map(({ path: filePath }) => filePath)
              .sort()
              .map((filePath) => `${filePath}\0`)
              .join(''),
          );
        }
        if (args.includes('--quiet')) return processResult('', { code: 1 });
        return processResult();
      case 'ls-files':
        return processResult(
          this.statuses
            .map(({ path: filePath }) => filePath)
            .sort()
            .map((filePath) => {
              const contents = this.stagedFiles.get(filePath);
              assert.ok(contents, `Missing staged contents for ${filePath}`);
              return `${this.options.indexMode || '100644'} ${gitBlobObjectId(contents)} 0\t${filePath}\0`;
            })
            .join(''),
        );
      case 'commit':
        this.options.mutateIndexOnCommit?.(this.stagedFiles);
        for (const [filePath, contents] of this.stagedFiles) {
          this.committedFiles.set(filePath, Buffer.from(contents));
        }
        this.committed = true;
        return processResult();
      case 'diff-tree':
        return processResult(
          [...this.committedFiles.keys()]
            .sort()
            .map((filePath) => `${filePath}\0`)
            .join(''),
        );
      case 'ls-tree':
        if (args.includes('--name-only')) {
          return processResult(
            this.options.privilegedDeveloperWorkflow ||
              this.options.developerWorkflowContents !== undefined
              ? '.github/workflows/ci.yml\0'
              : '',
          );
        }
        return processResult(
          [...this.committedFiles]
            .sort(([left], [right]) =>
              left < right ? -1 : left > right ? 1 : 0,
            )
            .map(
              ([filePath, contents]) =>
                `${this.options.indexMode || '100644'} blob ${gitBlobObjectId(contents)}\t${filePath}\0`,
            )
            .join(''),
        );
      case 'ls-remote':
        if (args.at(-1) === 'refs/heads/feature/widget') {
          return processResult(
            `${
              (this.pushed && this.options.remoteDeveloperShaAfterPush) ||
              this.options.remoteDeveloperSha ||
              DEVELOPER_SHA
            }\trefs/heads/feature/widget\n`,
          );
        }
        return processResult(
          this.options.remoteSha
            ? `${this.options.remoteSha}\t${args.at(-1)}\n`
            : '',
        );
      case 'push':
        this.options.onPush?.();
        if (options.env?.GIT_CONFIG_GLOBAL) {
          const credentialPath = options.env.GIT_CONFIG_GLOBAL;
          const stat = fs.statSync(credentialPath);
          this.credentialConfig = {
            contents: fs.readFileSync(credentialPath, 'utf8'),
            mode: stat.mode,
            path: credentialPath,
            uid: stat.uid,
          };
        }
        this.pushed = true;
        return processResult('ok\n');
      default:
        assert.fail(`Unhandled Git command: ${args.join(' ')}`);
    }
  };
}

function temporaryRepository(prefix: string): {
  cleanup: () => void;
  root: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(root, '.git', 'objects'), { recursive: true });
  return {
    cleanup: () => fs.rmSync(root, { force: true, recursive: true }),
    root,
  };
}

function writeFile(root: string, relativePath: string, contents = 'test\n') {
  const filename = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, contents);
}

function options(
  root: string,
  git: FakeGit,
  overrides: Partial<BotPrDeliveryOptions> = {},
  boundary: {
    fork?: Record<string, unknown>;
    forkActions?: unknown;
    forkActionsAfterDisable?: unknown;
    forkActionsAfterDisableStatus?: number;
    forkActionsDisableStatus?: number;
    forkActionsStatus?: number;
    forkStatus?: number;
    requests?: Array<{ init?: RequestInit; url: string }>;
    defaultBranchSha?: string;
    defaultBranchShaAfterInspection?: string;
    source?: Record<string, unknown>;
    sourceStatus?: number;
    workflows?: Array<{ contents: string; path: string; sha?: string }>;
  } = {},
): BotPrDeliveryOptions {
  const botUid = process.getuid?.() || 0;
  const botGid = process.getgid?.() || 0;
  const agentUid = botUid === 1001 ? 1002 : 1001;
  const requestedFetcher = overrides.fetcher;
  const result: BotPrDeliveryOptions = {
    botIdentity: { gid: botGid, home: root, uid: botUid },
    cwd: root,
    developerHeadRef: 'feature/widget',
    developerHeadSha: DEVELOPER_SHA,
    environment: {
      GIT_CONFIG_COUNT: '99',
      GIT_CONFIG_KEY_0: 'credential.helper',
      GIT_CONFIG_VALUE_0: 'unsafe-helper',
      PATH: '/usr/bin:/bin',
    },
    executionId: 'execution-42',
    forkRepository: 'playrunner-bot/example',
    githubToken: TOKEN,
    identity: {
      gid: agentUid,
      home: root,
      uid: agentUid,
    },
    nodeId: 'agent-node',
    repository: 'playrunner/example',
    runCommand: git.run,
    workflowId: 'workflow-1',
    ...overrides,
  };
  const sourceRepository = result.repository.replace(/\.git$/i, '');
  const forkRepository = result.forkRepository.replace(/\.git$/i, '');
  const sourceMetadata = {
    default_branch: 'main',
    full_name: 'playrunner/example',
    owner: { login: 'playrunner' },
    private: false,
    visibility: 'public',
    ...boundary.source,
  };
  const forkMetadata = {
    fork: true,
    full_name: 'playrunner-bot/example',
    owner: { login: 'playrunner-bot' },
    parent: { full_name: 'playrunner/example' },
    permissions: { push: true },
    private: false,
    visibility: 'public',
    ...boundary.fork,
  };
  const workflows = boundary.workflows || [];
  let forkActionsDisabledByRequest = false;
  let forkActionsReadCount = 0;
  let defaultBranchReadCount = 0;
  const workflowBySha = new Map(
    workflows.map((workflow) => [
      workflow.sha ||
        crypto.createHash('sha1').update(workflow.path).digest('hex'),
      workflow,
    ]),
  );
  result.fetcher = async (input, init) => {
    const url = new URL(String(input));
    boundary.requests?.push({ init, url: url.toString() });
    if (url.pathname === `/repos/${sourceRepository}`) {
      return jsonResponse(sourceMetadata, boundary.sourceStatus ?? 200);
    }
    if (url.pathname === `/repos/${forkRepository}`) {
      return jsonResponse(forkMetadata, boundary.forkStatus ?? 200);
    }
    if (
      url.pathname.toLowerCase() ===
      `/repos/${forkRepository}/actions/permissions`.toLowerCase()
    ) {
      if (init?.method === 'PUT') {
        const status = boundary.forkActionsDisableStatus ?? 204;
        if (status === 204) forkActionsDisabledByRequest = true;
        return status === 204
          ? new Response(null, { status })
          : jsonResponse({ message: 'Could not update Actions.' }, status);
      }
      const isVerification = forkActionsReadCount > 0;
      forkActionsReadCount += 1;
      const status = isVerification
        ? (boundary.forkActionsAfterDisableStatus ??
          boundary.forkActionsStatus ??
          200)
        : (boundary.forkActionsStatus ?? 200);
      const response = isVerification
        ? (boundary.forkActionsAfterDisable ??
          (forkActionsDisabledByRequest
            ? { enabled: false }
            : (boundary.forkActions ?? { enabled: false })))
        : (boundary.forkActions ?? { enabled: false });
      return jsonResponse(response, status);
    }
    if (
      url.pathname ===
      `/repos/${sourceRepository}/commits/${encodeURIComponent(String(sourceMetadata.default_branch || ''))}`
    ) {
      const sha =
        defaultBranchReadCount > 0 && boundary.defaultBranchShaAfterInspection
          ? boundary.defaultBranchShaAfterInspection
          : boundary.defaultBranchSha || DEFAULT_BRANCH_SHA;
      defaultBranchReadCount += 1;
      return jsonResponse({ sha }, 200);
    }
    if (
      url.pathname === `/repos/${sourceRepository}/contents/.github/workflows`
    ) {
      if (!workflows.length) return jsonResponse({ message: 'Not Found' }, 404);
      return jsonResponse(
        [...workflowBySha].map(([sha, workflow]) => ({
          path: workflow.path,
          sha,
          type: 'file',
        })),
        200,
      );
    }
    const blobPrefix = `/repos/${sourceRepository}/git/blobs/`;
    if (url.pathname.startsWith(blobPrefix)) {
      const sha = url.pathname.slice(blobPrefix.length);
      const workflow = workflowBySha.get(sha);
      if (!workflow) return jsonResponse({ message: 'Not Found' }, 404);
      const contents = Buffer.from(workflow.contents, 'utf8');
      return jsonResponse(
        {
          content: contents.toString('base64'),
          encoding: 'base64',
          sha,
          size: contents.length,
        },
        200,
      );
    }
    if (requestedFetcher) return requestedFetcher(input, init);
    throw new Error(`Unexpected fetch: ${url.toString()}`);
  };
  return result;
}

function jsonResponse(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

test('returns no_changes without creating a branch, push, or PR', async () => {
  const repository = temporaryRepository('bot-pr-empty-');
  try {
    const git = new FakeGit(repository.root, []);
    let fetched = false;
    const result = await deliverBotPullRequest(
      options(repository.root, git, {
        fetcher: async () => {
          fetched = true;
          return jsonResponse({}, 500);
        },
      }),
    );
    assert.deepEqual(result, {
      changedFiles: [],
      developerHeadSha: DEVELOPER_SHA,
      generatedTestFiles: [],
      status: 'no_changes',
    });
    assert.equal(git.pushed, false);
    assert.equal(fetched, false);
    assert.equal(
      git.calls.some(({ args }) => args.includes('switch')),
      false,
    );
  } finally {
    repository.cleanup();
  }
});

test('commits test-only changes and creates a credential-safe bot PR', async () => {
  const repository = temporaryRepository('bot-pr-created-');
  try {
    writeFile(repository.root, 'src/widget.test.ts');
    const git = new FakeGit(repository.root, [{ path: 'src/widget.test.ts' }], {
      remoteSha: REMOTE_SHA,
    });
    const requests: Array<{ init?: RequestInit; url: string }> = [];
    const result = await deliverBotPullRequest(
      options(repository.root, git, {
        fetcher: async (input, init) => {
          requests.push({ init, url: String(input) });
          return jsonResponse({ draft: true, number: 17 }, 201);
        },
      }),
    );

    if (result.status === 'no_changes') assert.fail('Expected a PR result.');
    assert.equal(result.status, 'created');
    assert.equal(result.commitSha, COMMIT_SHA);
    assert.deepEqual(result.changedFiles, ['src/widget.test.ts']);
    assert.deepEqual(result.generatedTestFiles, ['src/widget.test.ts']);
    assert.match(
      result.branchName,
      /^playrunner\/tests\/aaaaaaaaaaaa-[a-f0-9]{16}$/,
    );
    assert.deepEqual(result.pullRequest, {
      baseRef: 'feature/widget',
      draft: true,
      headRef: result.branchName,
      number: 17,
      title: `test: generate coverage for ${DEVELOPER_SHA}`,
      url: 'https://github.com/playrunner/example/pull/17',
    });

    const push = git.calls.find(({ args }) => args.includes('push'));
    assert.ok(push);
    assert.doesNotMatch(push.args.join(' '), new RegExp(TOKEN));
    assert.ok(
      push.args.includes(
        `--force-with-lease=refs/heads/${result.branchName}:${REMOTE_SHA}`,
      ),
    );
    assert.equal(push.options.env?.GIT_CONFIG_COUNT, undefined);
    assert.equal(push.options.env?.GIT_CONFIG_NOSYSTEM, '1');
    assert.equal(push.options.env?.GIT_CONFIG_KEY_0, undefined);
    assert.equal(push.options.env?.GIT_CONFIG_VALUE_0, undefined);
    assert.doesNotMatch(
      JSON.stringify(push.options.env || {}),
      new RegExp(TOKEN),
    );
    assert.notEqual(push.options.cwd, repository.root);
    assert.equal(
      push.options.env?.GIT_ALTERNATE_OBJECT_DIRECTORIES,
      fs.realpathSync(path.join(repository.root, '.git', 'objects')),
    );
    assert.ok(git.credentialConfig);
    assert.match(git.credentialConfig.contents, /Authorization: Basic /);
    assert.doesNotMatch(git.credentialConfig.contents, new RegExp(TOKEN));
    assert.equal(git.credentialConfig.mode & 0o077, 0);
    assert.equal(git.credentialConfig.uid, push.options.uid);
    assert.notEqual(push.options.uid, git.calls[0].options.uid);
    assert.equal(fs.existsSync(git.credentialConfig.path), false);
    for (const call of git.calls) {
      assert.doesNotMatch(call.args.join(' '), new RegExp(TOKEN));
      assert.doesNotMatch(
        JSON.stringify(call.options.env || {}),
        new RegExp(TOKEN),
      );
    }

    const commit = git.calls.find(({ args }) => args.includes('commit'));
    assert.ok(commit);
    assert.equal(commit.options.env?.GIT_AUTHOR_NAME, 'Playrunner Test Bot');
    assert.equal(
      commit.options.env?.GIT_AUTHOR_EMAIL,
      'test-bot@playrunner.dev',
    );
    assert.ok(commit.args.includes('core.hooksPath=/dev/null'));
    assert.ok(commit.args.includes('commit.gpgSign=false'));

    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].url,
      'https://api.github.com/repos/playrunner/example/pulls',
    );
    const headers = requests[0].init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, `Bearer ${TOKEN}`);
    const body = JSON.parse(String(requests[0].init?.body));
    assert.equal(body.base, 'feature/widget');
    assert.equal(body.draft, true);
    assert.equal(body.head, `playrunner-bot:${result.branchName}`);
    assert.equal(body.head_repo, 'playrunner-bot/example');
    assert.match(body.title, new RegExp(DEVELOPER_SHA));
    assert.match(body.body, new RegExp(DEVELOPER_SHA));
    assert.match(body.body, /execution-42/);
    assert.match(body.body, /agent-node/);
    assert.match(body.body, /repository-controlled test code/);
    assert.match(body.body, /source-repository CI must pass/);
  } finally {
    repository.cleanup();
  }
});

test('refuses to share the untrusted agent identity with bot delivery', async () => {
  const repository = temporaryRepository('bot-pr-identity-boundary-');
  try {
    writeFile(repository.root, 'tests/widget.spec.ts');
    const git = new FakeGit(repository.root, [
      { path: 'tests/widget.spec.ts' },
    ]);
    const deliveryOptions = options(repository.root, git);
    deliveryOptions.botIdentity = deliveryOptions.identity;
    await assert.rejects(
      deliverBotPullRequest(deliveryOptions),
      /privileged bot identity distinct from the untrusted agent UID/,
    );
    assert.equal(git.committed, false);
    assert.equal(git.pushed, false);
  } finally {
    repository.cleanup();
  }
});

test('uses the verified fork metadata owner for the cross-repository PR head', async () => {
  const repository = temporaryRepository('bot-pr-verified-owner-');
  try {
    writeFile(repository.root, 'tests/widget.spec.ts');
    const git = new FakeGit(repository.root, [
      { path: 'tests/widget.spec.ts' },
    ]);
    let requestBody: Record<string, unknown> | undefined;
    const result = await deliverBotPullRequest(
      options(
        repository.root,
        git,
        {
          fetcher: async (_input, init) => {
            requestBody = JSON.parse(String(init?.body));
            return jsonResponse({ draft: true, number: 18 }, 201);
          },
          forkRepository: 'PLAYRUNNER-BOT/example',
        },
        {
          fork: {
            full_name: 'playrunner-bot/example',
            owner: { login: 'playrunner-bot' },
          },
        },
      ),
    );
    if (result.status === 'no_changes') assert.fail('Expected a PR result.');
    assert.equal(requestBody?.head, `playrunner-bot:${result.branchName}`);
    assert.equal(requestBody?.head_repo, 'playrunner-bot/example');
    const push = git.calls.find(({ args }) => args.includes('push'));
    assert.ok(
      push?.args.includes('https://github.com/playrunner-bot/example.git'),
    );
  } finally {
    repository.cleanup();
  }
});

test('requires a distinct verified public fork with push access', async () => {
  const repository = temporaryRepository('bot-pr-fork-boundary-');
  try {
    writeFile(repository.root, 'tests/widget.spec.ts');

    const sameRepositoryGit = new FakeGit(repository.root, [
      { path: 'tests/widget.spec.ts' },
    ]);
    await assert.rejects(
      deliverBotPullRequest(
        options(repository.root, sameRepositoryGit, {
          forkRepository: 'playrunner/example',
        }),
      ),
      /requires a distinct public fork/,
    );
    assert.equal(sameRepositoryGit.committed, false);

    const cases: Array<{
      boundary: Parameters<typeof options>[3];
      message: RegExp;
    }> = [
      {
        boundary: {
          source: { private: true, visibility: 'private' },
        },
        message: /source repository must be public/,
      },
      {
        boundary: {
          fork: { private: true, visibility: 'private' },
        },
        message: /fork repository must be public/,
      },
      {
        boundary: {
          fork: { parent: { full_name: 'someone/else' } },
        },
        message: /must be a direct GitHub fork/,
      },
      {
        boundary: { fork: { permissions: { push: false } } },
        message: /cannot push.*Contents: read and write/,
      },
    ];
    for (const item of cases) {
      const git = new FakeGit(repository.root, [
        { path: 'tests/widget.spec.ts' },
      ]);
      await assert.rejects(
        deliverBotPullRequest(options(repository.root, git, {}, item.boundary)),
        item.message,
      );
      assert.equal(git.committed, false);
      assert.equal(git.pushed, false);
    }
  } finally {
    repository.cleanup();
  }
});

test('disables and re-verifies Actions on the dedicated fork before pushing', async () => {
  const repository = temporaryRepository('bot-pr-fork-actions-disable-');
  try {
    writeFile(repository.root, 'tests/widget.spec.ts');
    const requests: Array<{ init?: RequestInit; url: string }> = [];
    const actionsRequests = () =>
      requests.filter(({ url }) =>
        new URL(url).pathname.endsWith('/actions/permissions'),
      );
    const git = new FakeGit(
      repository.root,
      [{ path: 'tests/widget.spec.ts' }],
      {
        onPush: () => {
          assert.deepEqual(
            actionsRequests().map(({ init }) => init?.method),
            ['GET', 'PUT', 'GET'],
          );
        },
      },
    );
    await deliverBotPullRequest(
      options(
        repository.root,
        git,
        {
          fetcher: async () => jsonResponse({ draft: true, number: 19 }, 201),
        },
        {
          forkActions: { enabled: true },
          requests,
        },
      ),
    );

    assert.equal(git.pushed, true);
    assert.deepEqual(
      actionsRequests().map(({ init }) => init?.method),
      ['GET', 'PUT', 'GET'],
    );
    assert.deepEqual(JSON.parse(String(actionsRequests()[1].init?.body)), {
      enabled: false,
    });
  } finally {
    repository.cleanup();
  }
});

test('accepts an already-disabled dedicated fork without changing settings', async () => {
  const repository = temporaryRepository('bot-pr-fork-actions-disabled-');
  try {
    writeFile(repository.root, 'tests/widget.spec.ts');
    const requests: Array<{ init?: RequestInit; url: string }> = [];
    const git = new FakeGit(
      repository.root,
      [{ path: 'tests/widget.spec.ts' }],
      {
        onPush: () => {
          assert.equal(
            requests.filter(({ url }) =>
              new URL(url).pathname.endsWith('/actions/permissions'),
            ).length,
            1,
          );
        },
      },
    );
    await deliverBotPullRequest(
      options(
        repository.root,
        git,
        {
          fetcher: async () => jsonResponse({ draft: true, number: 20 }, 201),
        },
        { forkActions: { enabled: false }, requests },
      ),
    );
    assert.equal(git.pushed, true);
    assert.equal(
      requests.some(
        ({ init, url }) =>
          new URL(url).pathname.endsWith('/actions/permissions') &&
          init?.method === 'PUT',
      ),
      false,
    );
  } finally {
    repository.cleanup();
  }
});

test('fails closed when dedicated-fork Actions cannot be verified or disabled', async () => {
  const repository = temporaryRepository('bot-pr-fork-actions-failure-');
  try {
    writeFile(repository.root, 'tests/widget.spec.ts');
    const cases: Array<{
      boundary: Parameters<typeof options>[3];
      name: string;
    }> = [
      {
        boundary: { forkActionsStatus: 403 },
        name: 'permission read denied',
      },
      {
        boundary: { forkActions: { allowed_actions: 'all' } },
        name: 'malformed permission response',
      },
      {
        boundary: {
          forkActions: { enabled: true },
          forkActionsDisableStatus: 403,
        },
        name: 'disable denied',
      },
      {
        boundary: {
          forkActions: { enabled: true },
          forkActionsAfterDisable: { enabled: true },
        },
        name: 'disable not effective',
      },
    ];
    for (const item of cases) {
      const git = new FakeGit(repository.root, [
        { path: 'tests/widget.spec.ts' },
      ]);
      await assert.rejects(
        deliverBotPullRequest(options(repository.root, git, {}, item.boundary)),
        /requires GitHub Actions to be disabled.*Settings > Actions > General.*Administration: read and write/,
        item.name,
      );
      assert.equal(git.pushed, false, item.name);
    }
  } finally {
    repository.cleanup();
  }
});

test('rejects privileged source workflow triggers before committing or pushing', async () => {
  const repository = temporaryRepository('bot-pr-workflow-boundary-');
  try {
    writeFile(repository.root, 'tests/widget.spec.ts');

    const developerWorkflowGit = new FakeGit(
      repository.root,
      [{ path: 'tests/widget.spec.ts' }],
      { privilegedDeveloperWorkflow: true },
    );
    await assert.rejects(
      deliverBotPullRequest(options(repository.root, developerWorkflowGit)),
      /pull_request_target or workflow_run/,
    );
    assert.equal(developerWorkflowGit.committed, false);
    assert.equal(developerWorkflowGit.pushed, false);

    for (const trigger of ['pull_request_target', 'workflow_run']) {
      const git = new FakeGit(repository.root, [
        { path: 'tests/widget.spec.ts' },
      ]);
      const requests: Array<{ init?: RequestInit; url: string }> = [];
      await assert.rejects(
        deliverBotPullRequest(
          options(
            repository.root,
            git,
            {},
            {
              requests,
              workflows: [
                {
                  contents: `name: privileged\non:\n  ${trigger}:\n`,
                  path: '.github/workflows/privileged.yml',
                },
              ],
            },
          ),
        ),
        /pull_request_target or workflow_run/,
      );
      assert.equal(git.committed, false);
      assert.equal(git.pushed, false);
      assert.ok(
        requests.some(({ url }) =>
          url.includes(`/contents/.github/workflows?ref=${DEFAULT_BRANCH_SHA}`),
        ),
      );
      assert.ok(requests.some(({ url }) => url.includes('/git/blobs/')));
      assert.equal(
        requests.some(({ url }) => /download|raw\.github/i.test(url)),
        false,
      );
      for (const request of requests) {
        const headers = request.init?.headers as Record<string, string>;
        assert.equal(headers.Authorization, `Bearer ${TOKEN}`);
      }
    }

    for (const encodedTrigger of [
      String.raw`"pull\u005frequest_target":`,
      String.raw`"pull_request_\u0074arget":`,
      String.raw`"workflow\x5frun":`,
    ]) {
      const git = new FakeGit(repository.root, [
        { path: 'tests/widget.spec.ts' },
      ]);
      await assert.rejects(
        deliverBotPullRequest(
          options(
            repository.root,
            git,
            {},
            {
              workflows: [
                {
                  contents: `name: encoded privileged trigger\non:\n  ${encodedTrigger}\n`,
                  path: '.github/workflows/encoded.yml',
                },
              ],
            },
          ),
        ),
        /statically declared standard GitHub-hosted runs-on labels/,
      );
      assert.equal(git.committed, false);
      assert.equal(git.pushed, false);
    }
  } finally {
    repository.cleanup();
  }
});

test('allows only static standard GitHub-hosted runners in source workflows', async () => {
  const repository = temporaryRepository('bot-pr-hosted-runners-');
  try {
    writeFile(repository.root, 'tests/widget.spec.ts');
    const git = new FakeGit(repository.root, [
      { path: 'tests/widget.spec.ts' },
    ]);
    const result = await deliverBotPullRequest(
      options(
        repository.root,
        git,
        {
          fetcher: async () => jsonResponse({ draft: true, number: 19 }, 201),
        },
        {
          workflows: [
            {
              contents: [
                'name: hosted',
                'on: pull_request',
                'jobs:',
                '  linux:',
                '    runs-on: ubuntu-latest',
                '  windows:',
                '    runs-on: "windows-2022"',
                '  mac:',
                "    runs-on: 'macos-14'",
                '',
              ].join('\n'),
              path: '.github/workflows/hosted.yml',
            },
          ],
        },
      ),
    );
    assert.equal(result.status, 'created');
    assert.equal(git.pushed, true);
  } finally {
    repository.cleanup();
  }
});

test('fails closed on self-hosted, indirect, or custom source runner selection', async () => {
  const repository = temporaryRepository('bot-pr-unsafe-runners-');
  try {
    writeFile(repository.root, 'tests/widget.spec.ts');
    const unsafeWorkflows = [
      ['self-hosted', 'jobs:\n  test:\n    runs-on: self-hosted\n'],
      ['custom', 'jobs:\n  test:\n    runs-on: gpu-runner\n'],
      [
        'runner group',
        'jobs:\n  test:\n    runs-on:\n      group: production-runners\n',
      ],
      ['expression', 'jobs:\n  test:\n    runs-on: ${{ inputs.runner }}\n'],
      [
        'matrix',
        'jobs:\n  test:\n    strategy:\n      matrix:\n        os: [ubuntu-latest]\n    runs-on: ${{ matrix.os }}\n',
      ],
      [
        'anchor',
        'runner: &runner ubuntu-latest\njobs:\n  test:\n    runs-on: *runner\n',
      ],
      [
        'key alias',
        'runnerKey: &rk runs-on\njobs:\n  test:\n    *rk: gpu-runner\n',
      ],
      [
        'merge alias',
        'runner: &runner\n  runs-on: ubuntu-latest\njobs:\n  test:\n    <<: *runner\n',
      ],
      [
        'reusable workflow',
        'jobs:\n  test:\n    uses: owner/repo/.github/workflows/test.yml@main\n',
      ],
      ['missing runner', 'jobs:\n  test:\n    steps:\n      - run: npm test\n'],
    ] as const;
    for (const [name, contents] of unsafeWorkflows) {
      const git = new FakeGit(repository.root, [
        { path: 'tests/widget.spec.ts' },
      ]);
      await assert.rejects(
        deliverBotPullRequest(
          options(
            repository.root,
            git,
            {},
            {
              workflows: [
                {
                  contents,
                  path: `.github/workflows/${name.replace(' ', '-')}.yml`,
                },
              ],
            },
          ),
        ),
        /only statically declared standard GitHub-hosted runs-on labels/,
        name,
      );
      assert.equal(git.committed, false, name);
      assert.equal(git.pushed, false, name);
    }

    const developerHeadGit = new FakeGit(
      repository.root,
      [{ path: 'tests/widget.spec.ts' }],
      {
        developerWorkflowContents:
          'jobs:\n  test:\n    runs-on:\n      group: internal-runners\n',
      },
    );
    await assert.rejects(
      deliverBotPullRequest(options(repository.root, developerHeadGit)),
      /only statically declared standard GitHub-hosted runs-on labels/,
    );
    assert.equal(developerHeadGit.committed, false);
    assert.equal(developerHeadGit.pushed, false);
  } finally {
    repository.cleanup();
  }
});

test('resolves an existing open PR after GitHub returns an idempotency conflict', async () => {
  const repository = temporaryRepository('bot-pr-existing-');
  try {
    writeFile(repository.root, 'tests/widget.spec.ts');
    const git = new FakeGit(repository.root, [
      { path: 'tests/widget.spec.ts' },
    ]);
    let branchName = '';
    let requestCount = 0;
    const result = await deliverBotPullRequest(
      options(repository.root, git, {
        fetcher: async (input, init) => {
          requestCount += 1;
          if (requestCount === 1) {
            const qualifiedHead = String(JSON.parse(String(init?.body)).head);
            assert.match(qualifiedHead, /^playrunner-bot:/);
            branchName = qualifiedHead.slice('playrunner-bot:'.length);
            return jsonResponse({ message: 'already exists' }, 422);
          }
          assert.match(String(input), /state=open/);
          assert.match(
            String(input),
            /head=playrunner-bot%3Aplayrunner%2Ftests%2F/,
          );
          return jsonResponse(
            [
              {
                base: { ref: 'feature/widget' },
                head: {
                  ref: branchName,
                  repo: {
                    full_name: 'playrunner-bot/example',
                    owner: { login: 'playrunner-bot' },
                  },
                },
                draft: true,
                number: 91,
              },
            ],
            200,
          );
        },
      }),
    );
    if (result.status === 'no_changes') assert.fail('Expected a PR result.');
    assert.equal(result.status, 'existing');
    assert.equal(result.pullRequest.number, 91);
    assert.equal(result.pullRequest.headRef, branchName);
    assert.equal(result.pullRequest.baseRef, 'feature/widget');
    assert.equal(requestCount, 2);
  } finally {
    repository.cleanup();
  }
});

test('reconciles retries with a fresh execution ID onto the same bot PR', async () => {
  const firstRepository = temporaryRepository('bot-pr-retry-first-');
  const retryRepository = temporaryRepository('bot-pr-retry-second-');
  try {
    writeFile(firstRepository.root, 'tests/widget.spec.ts');
    writeFile(retryRepository.root, 'tests/widget.spec.ts');
    const firstGit = new FakeGit(firstRepository.root, [
      { path: 'tests/widget.spec.ts' },
    ]);
    const first = await deliverBotPullRequest(
      options(firstRepository.root, firstGit, {
        executionId: 'execution-first',
        fetcher: async () => jsonResponse({ draft: true, number: 17 }, 201),
      }),
    );
    if (first.status === 'no_changes') assert.fail('Expected a PR result.');

    const retryGit = new FakeGit(
      retryRepository.root,
      [{ path: 'tests/widget.spec.ts' }],
      { remoteSha: REMOTE_SHA },
    );
    let requestCount = 0;
    const retry = await deliverBotPullRequest(
      options(retryRepository.root, retryGit, {
        executionId: 'execution-retry',
        fetcher: async (_input, init) => {
          requestCount += 1;
          if (requestCount === 1) {
            assert.equal(
              JSON.parse(String(init?.body)).head,
              `playrunner-bot:${first.branchName}`,
            );
            return jsonResponse({ message: 'already exists' }, 422);
          }
          return jsonResponse(
            [
              {
                base: { ref: 'feature/widget' },
                head: {
                  ref: first.branchName,
                  repo: {
                    full_name: 'playrunner-bot/example',
                    owner: { login: 'playrunner-bot' },
                  },
                },
                draft: true,
                number: 17,
              },
            ],
            200,
          );
        },
      }),
    );
    if (retry.status === 'no_changes') assert.fail('Expected a PR result.');

    assert.equal(retry.branchName, first.branchName);
    assert.equal(retry.status, 'existing');
    assert.equal(retry.pullRequest.number, first.pullRequest.number);
    assert.equal(requestCount, 2);
  } finally {
    firstRepository.cleanup();
    retryRepository.cleanup();
  }
});

test('rejects production changes before creating a branch or using the network', async () => {
  const repository = temporaryRepository('bot-pr-production-');
  try {
    writeFile(repository.root, 'src/widget.ts');
    const git = new FakeGit(repository.root, [{ path: 'src/widget.ts' }]);
    await assert.rejects(
      deliverBotPullRequest(options(repository.root, git)),
      /limited to tests and approved test configuration/,
    );
    assert.equal(git.pushed, false);
    assert.equal(
      git.calls.some(({ args }) => args.includes('switch')),
      false,
    );
  } finally {
    repository.cleanup();
  }
});

test('rejects credential values in changed paths before commit or network access', async () => {
  const repository = temporaryRepository('bot-pr-secret-path-');
  const credential = 'model-secret-value';
  const filePath = `tests/${credential}.spec.ts`;
  const requests: Array<{ init?: RequestInit; url: string }> = [];
  try {
    writeFile(repository.root, filePath);
    const git = new FakeGit(repository.root, [{ path: filePath }]);
    await assert.rejects(
      deliverBotPullRequest(
        options(
          repository.root,
          git,
          { prohibitedExactValues: [credential] },
          { requests },
        ),
      ),
      (error: Error) => {
        assert.match(error.message, /blocked output/);
        assert.doesNotMatch(error.message, new RegExp(credential));
        return true;
      },
    );
    assert.equal(git.committed, false);
    assert.equal(git.pushed, false);
    assert.deepEqual(requests, []);
  } finally {
    repository.cleanup();
  }
});

test('rejects executable or network-sensitive repository Git configuration', async () => {
  const repository = temporaryRepository('bot-pr-git-config-');
  try {
    writeFile(repository.root, 'tests/widget.test.ts');
    for (const key of [
      'url.https://attacker.test/.insteadof',
      'credential.helper',
      'http.proxy',
      'include.path',
      'core.fsmonitor',
      'filter.evil.process',
      'diff.external',
      'merge.evil.driver',
      'alias.status',
      'core.sshCommand',
      'pager.status',
      'submodule.vendor.update',
      'pack.packObjectsHook',
    ]) {
      const git = new FakeGit(
        repository.root,
        [{ path: 'tests/widget.test.ts' }],
        { dangerousConfig: key },
      );
      await assert.rejects(
        deliverBotPullRequest(options(repository.root, git)),
        /refuses executable or network-sensitive local Git configuration/,
        key,
      );
      assert.equal(git.pushed, false, key);
    }
  } finally {
    repository.cleanup();
  }
});

test('rejects deleted tests and unsafe traversal paths', async () => {
  const repository = temporaryRepository('bot-pr-paths-');
  try {
    writeFile(repository.root, 'tests/widget.test.ts');
    const deleted = new FakeGit(repository.root, [
      { path: 'tests/widget.test.ts', status: ' D' },
    ]);
    await assert.rejects(
      deliverBotPullRequest(options(repository.root, deleted)),
      /cannot deliver Git status/,
    );

    const traversal = new FakeGit(repository.root, [
      { path: '../widget.test.ts' },
    ]);
    await assert.rejects(
      deliverBotPullRequest(options(repository.root, traversal)),
      /unsafe changed-file path/,
    );
  } finally {
    repository.cleanup();
  }
});

test('rejects symbolic links and sensitive test artifacts', async () => {
  const repository = temporaryRepository('bot-pr-links-');
  const external = temporaryRepository('bot-pr-external-');
  try {
    writeFile(external.root, 'outside.test.ts');
    fs.mkdirSync(path.join(repository.root, 'tests'));
    fs.symlinkSync(
      path.join(external.root, 'outside.test.ts'),
      path.join(repository.root, 'tests', 'linked.test.ts'),
    );
    const linked = new FakeGit(repository.root, [
      { path: 'tests/linked.test.ts' },
    ]);
    await assert.rejects(
      deliverBotPullRequest(options(repository.root, linked)),
      /refuses symbolic links/,
    );

    writeFile(repository.root, 'tests/.env.test');
    const sensitive = new FakeGit(repository.root, [
      { path: 'tests/.env.test' },
    ]);
    await assert.rejects(
      deliverBotPullRequest(options(repository.root, sensitive)),
      /potentially sensitive file/,
    );
  } finally {
    external.cleanup();
    repository.cleanup();
  }
});

test('enforces changed-file size and count limits', async () => {
  const repository = temporaryRepository('bot-pr-bounds-');
  try {
    const largePath = 'tests/large.test.ts';
    const descriptor = fs.openSync(
      path.join(repository.root, 'large.tmp'),
      'w',
    );
    fs.ftruncateSync(descriptor, MAX_BOT_PR_FILE_BYTES + 1);
    fs.closeSync(descriptor);
    fs.mkdirSync(path.join(repository.root, 'tests'));
    fs.renameSync(
      path.join(repository.root, 'large.tmp'),
      path.join(repository.root, largePath),
    );
    const large = new FakeGit(repository.root, [{ path: largePath }]);
    await assert.rejects(
      deliverBotPullRequest(options(repository.root, large)),
      /changed file is too large/,
    );

    const statuses = Array.from(
      { length: MAX_BOT_PR_CHANGED_FILES + 1 },
      (_, index) => ({ path: `tests/generated-${index}.test.ts` }),
    );
    for (const status of statuses) writeFile(repository.root, status.path);
    const tooMany = new FakeGit(repository.root, statuses);
    await assert.rejects(
      deliverBotPullRequest(options(repository.root, tooMany)),
      /too many changed files/,
    );
  } finally {
    repository.cleanup();
  }
});

test('rejects package manifests and lockfiles without using the network', async () => {
  const repository = temporaryRepository('bot-pr-manifest-');
  try {
    for (const filePath of ['package.json', 'package-lock.json', 'yarn.lock']) {
      writeFile(repository.root, filePath, '{}');
      const git = new FakeGit(repository.root, [
        { path: filePath, status: ' M' },
      ]);
      await assert.rejects(
        deliverBotPullRequest(options(repository.root, git)),
        /dependency manifests and lockfiles are not allowed/,
      );
      assert.equal(git.committed, false);
      assert.equal(git.pushed, false);
    }
  } finally {
    repository.cleanup();
  }
});

test('rejects a test file mutated after validation but before staging', async () => {
  const repository = temporaryRepository('bot-pr-stage-race-');
  try {
    writeFile(repository.root, 'tests/new.spec.ts', 'test("approved");\n');
    const git = new FakeGit(repository.root, [{ path: 'tests/new.spec.ts' }], {
      mutateOnAdd: () =>
        writeFile(
          repository.root,
          'tests/new.spec.ts',
          'throw new Error("replaced");\n',
        ),
    });

    await assert.rejects(
      deliverBotPullRequest(options(repository.root, git)),
      /staged content differs from its validated snapshot: tests\/new\.spec\.ts/,
    );
    assert.equal(git.committed, false);
    assert.equal(git.pushed, false);
  } finally {
    repository.cleanup();
  }
});

test('rejects an unexpected path added to the index while committing', async () => {
  const repository = temporaryRepository('bot-pr-commit-path-race-');
  try {
    writeFile(repository.root, 'tests/new.spec.ts');
    const git = new FakeGit(repository.root, [{ path: 'tests/new.spec.ts' }], {
      mutateIndexOnCommit: (stagedFiles) => {
        stagedFiles.set(
          'src/injected.ts',
          Buffer.from('export const injected = true;\n'),
        );
      },
    });

    await assert.rejects(
      deliverBotPullRequest(options(repository.root, git)),
      /commit changed paths after staged validation/,
    );
    assert.equal(git.committed, true);
    assert.equal(git.pushed, false);
  } finally {
    repository.cleanup();
  }
});

test('rejects validated content replaced in the index while committing', async () => {
  const repository = temporaryRepository('bot-pr-commit-blob-race-');
  try {
    writeFile(repository.root, 'tests/new.spec.ts');
    const git = new FakeGit(repository.root, [{ path: 'tests/new.spec.ts' }], {
      mutateIndexOnCommit: (stagedFiles) => {
        stagedFiles.set(
          'tests/new.spec.ts',
          Buffer.from('throw new Error("injected");\n'),
        );
      },
    });

    await assert.rejects(
      deliverBotPullRequest(options(repository.root, git)),
      /commit differs from its validated snapshot: tests\/new\.spec\.ts/,
    );
    assert.equal(git.committed, true);
    assert.equal(git.pushed, false);
  } finally {
    repository.cleanup();
  }
});

test('rejects non-file Git index modes before committing', async () => {
  const repository = temporaryRepository('bot-pr-index-mode-');
  try {
    writeFile(repository.root, 'tests/widget.test.ts');
    const git = new FakeGit(
      repository.root,
      [{ path: 'tests/widget.test.ts' }],
      { indexMode: '120000' },
    );
    await assert.rejects(
      deliverBotPullRequest(options(repository.root, git)),
      /link or non-file entry/,
    );
    assert.equal(git.pushed, false);
    assert.equal(git.committed, false);
  } finally {
    repository.cleanup();
  }
});

test('fails closed on a mismatched developer SHA and Git timeouts', async () => {
  const repository = temporaryRepository('bot-pr-head-');
  try {
    const mismatched = new FakeGit(repository.root, [], {
      reportedHead: 'f'.repeat(40),
    });
    await assert.rejects(
      deliverBotPullRequest(options(repository.root, mismatched)),
      /not at the requested developer SHA/,
    );

    const timedOut = new FakeGit(repository.root, [], {
      timeoutOperation: 'status',
    });
    await assert.rejects(
      deliverBotPullRequest(options(repository.root, timedOut)),
      /reading generated changes timed out/,
    );
  } finally {
    repository.cleanup();
  }
});

test('does not push when the remote developer branch has moved', async () => {
  const repository = temporaryRepository('bot-pr-remote-head-');
  try {
    writeFile(repository.root, 'tests/widget.test.ts');
    const git = new FakeGit(
      repository.root,
      [{ path: 'tests/widget.test.ts' }],
      { remoteDeveloperSha: 'e'.repeat(40) },
    );
    await assert.rejects(
      deliverBotPullRequest(options(repository.root, git)),
      /developer branch moved/,
    );
    assert.equal(git.pushed, false);
  } finally {
    repository.cleanup();
  }
});

test('does not create a PR when the developer branch moves after the bot push', async () => {
  const repository = temporaryRepository('bot-pr-post-push-head-');
  try {
    writeFile(repository.root, 'tests/widget.test.ts');
    const git = new FakeGit(
      repository.root,
      [{ path: 'tests/widget.test.ts' }],
      { remoteDeveloperShaAfterPush: 'e'.repeat(40) },
    );
    let pullRequestAttempted = false;
    await assert.rejects(
      deliverBotPullRequest(
        options(repository.root, git, {
          fetcher: async () => {
            pullRequestAttempted = true;
            return jsonResponse({ draft: true, number: 17 }, 201);
          },
        }),
      ),
      /developer branch moved/,
    );
    assert.equal(git.pushed, true);
    assert.equal(pullRequestAttempted, false);
  } finally {
    repository.cleanup();
  }
});

test('does not create a PR when the inspected default branch moves after the bot push', async () => {
  const repository = temporaryRepository('bot-pr-default-head-race-');
  try {
    writeFile(repository.root, 'tests/widget.test.ts');
    const git = new FakeGit(repository.root, [
      { path: 'tests/widget.test.ts' },
    ]);
    let pullRequestAttempted = false;
    await assert.rejects(
      deliverBotPullRequest(
        options(
          repository.root,
          git,
          {
            fetcher: async () => {
              pullRequestAttempted = true;
              return jsonResponse({ draft: true, number: 17 }, 201);
            },
          },
          { defaultBranchShaAfterInspection: 'e'.repeat(40) },
        ),
      ),
      /source default branch moved after its workflow safety inspection/,
    );
    assert.equal(git.pushed, true);
    assert.equal(pullRequestAttempted, false);
  } finally {
    repository.cleanup();
  }
});

test('never reuses the developer branch as the deterministic bot branch', async () => {
  const repository = temporaryRepository('bot-pr-branch-collision-');
  try {
    writeFile(repository.root, 'tests/widget.test.ts');
    const discriminator = crypto
      .createHash('sha256')
      .update('playrunner/example')
      .update('\0')
      .update('workflow-1')
      .update('\0')
      .update(DEVELOPER_SHA)
      .update('\0')
      .update('agent-node')
      .digest('hex')
      .slice(0, 16);
    const branchName = `playrunner/tests/${DEVELOPER_SHA.slice(0, 12)}-${discriminator}`;
    const git = new FakeGit(repository.root, [
      { path: 'tests/widget.test.ts' },
    ]);
    await assert.rejects(
      deliverBotPullRequest(
        options(repository.root, git, { developerHeadRef: branchName }),
      ),
      /branch must differ from the developer branch/,
    );
    assert.equal(git.committed, false);
    assert.equal(git.pushed, false);
  } finally {
    repository.cleanup();
  }
});

test('bounds GitHub responses and does not accept unrelated conflict results', async () => {
  const repository = temporaryRepository('bot-pr-api-bounds-');
  try {
    writeFile(repository.root, 'tests/widget.test.ts');
    const git = new FakeGit(repository.root, [
      { path: 'tests/widget.test.ts' },
    ]);
    await assert.rejects(
      deliverBotPullRequest(
        options(repository.root, git, {
          fetcher: async () =>
            new Response('{}', {
              headers: { 'Content-Length': String(2 * 1024 * 1024) },
              status: 201,
            }),
        }),
      ),
      /response exceeded the size limit/,
    );

    const retryGit = new FakeGit(repository.root, [
      { path: 'tests/widget.test.ts' },
    ]);
    let request = 0;
    await assert.rejects(
      deliverBotPullRequest(
        options(repository.root, retryGit, {
          fetcher: async () => {
            request += 1;
            return request === 1
              ? jsonResponse({ message: 'validation failed' }, 422)
              : jsonResponse([], 200);
          },
        }),
      ),
      /did not return the existing bot PR/,
    );
  } finally {
    repository.cleanup();
  }
});
