import fs from 'node:fs';
import path from 'node:path';
import { runProcess, type ProcessResult } from './process';
import {
  normalizeCiChangeContext,
  normalizeGitHubRepository,
  type AgentRunnerPayload,
  type CiChangeContext,
} from './payload';

export const CHANGE_MANIFEST_SCHEMA_VERSION = '1.0' as const;
export const MAX_CHANGE_MANIFEST_BYTES = 2 * 1024 * 1024;
export const MAX_CHANGED_FILES = 2_000;
export const MAX_CHANGED_LINES = 250_000;
export const MAX_CHANGED_LINE_RANGES = 50_000;

const MAX_GIT_DATA_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_DIFF_BYTES = 16 * 1024 * 1024;
const MAX_REPOSITORY_PATH_BYTES = 4_096;
const GIT_TIMEOUT_MS = 10 * 60_000;
const MAX_PULL_REQUEST_HISTORY_DEPTH = 10_000;
const GIT_OBJECT_ID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export type AgentIdentity = {
  gid: number;
  home: string;
  uid: number;
};

export type ChangedLineRange = {
  /** First changed line in the head revision, 1-based and inclusive. */
  start: number;
  /** Last changed line in the head revision, 1-based and inclusive. */
  end: number;
};

export type ChangeManifestFile = {
  binary: boolean;
  changedLineCount: number;
  changedLines: ChangedLineRange[];
  classification: 'config' | 'production' | 'test';
  path: string;
  previousPath?: string;
  status:
    | 'added'
    | 'copied'
    | 'deleted'
    | 'modified'
    | 'renamed'
    | 'type_changed';
};

export type ChangeManifest = {
  context: CiChangeContext;
  files: ChangeManifestFile[];
  schemaVersion: typeof CHANGE_MANIFEST_SCHEMA_VERSION;
  summary: {
    changedFiles: number;
    changedLines: number;
    configChangedLines: number;
    configFiles: number;
    productionChangedLines: number;
    productionFiles: number;
    testChangedLines: number;
    testFiles: number;
  };
};

export type PreparedRepository = {
  changeContext?: CiChangeContext;
  changeManifest?: ChangeManifest;
  headRevision: string;
  repositoryRoot: string;
  supportingRepositories?: PreparedSupportingRepository[];
  workingDirectory: string;
};

export type PreparedSupportingRepository = {
  branch: string;
  folder: string;
  headRevision: string;
  repository: string;
  repositoryRoot: string;
  workingDirectory: string;
};

type RunCommand = (
  command: string,
  args: string[],
  options: Parameters<typeof runProcess>[2],
) => Promise<ProcessResult>;

export type RepositoryOptions = {
  environment?: NodeJS.ProcessEnv;
  identity?: AgentIdentity;
  repositoryRoot?: string;
  runCommand?: RunCommand;
};

type RawChangedFile = {
  path: string;
  previousPath?: string;
  status: ChangeManifestFile['status'];
};

type SupportingRepositoryConfig = {
  branch: string;
  folder: string;
  repository: string;
};

function supportingRepositoryConfigs(
  payload: AgentRunnerPayload,
): SupportingRepositoryConfig[] {
  const configured = payload.config.supportingRepositories;
  if (configured === undefined) return [];
  if (!Array.isArray(configured) || configured.length > 10) {
    throw new Error(
      'AI Container supportingRepositories must contain at most 10 repositories.',
    );
  }
  const primary = normalizeGitHubRepository(payload.config.repository);
  const repositories = configured.map((candidate, index) => {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate)
    ) {
      throw new Error(
        `AI Container supportingRepositories[${index}] must be an object.`,
      );
    }
    const config = candidate as Record<string, unknown>;
    const repository = normalizeGitHubRepository(
      config.repository,
      `config.supportingRepositories[${index}].repository`,
    );
    const branch = String(config.branch || 'main').trim() || 'main';
    const folder = String(config.folder || '.').trim() || '.';
    return { branch, folder, repository };
  });
  const names = [
    primary,
    ...repositories.map(({ repository }) => repository),
  ].map((repository) => repository.toLowerCase());
  if (new Set(names).size !== names.length) {
    throw new Error('AI Container repositories must be unique.');
  }
  return repositories;
}

function makeTreeReadOnly(target: string): void {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target)) {
      makeTreeReadOnly(path.join(target, entry));
    }
  }
  fs.chmodSync(target, stat.mode & ~0o222);
}

async function prepareSupportingRepositories(
  payload: AgentRunnerPayload,
  primaryRoot: string,
  options: RepositoryOptions,
): Promise<PreparedSupportingRepository[]> {
  const configs = supportingRepositoryConfigs(payload);
  if (!configs.length) return [];
  const supportingRoot = assertSafeRepositoryRoot(
    path.join(path.dirname(primaryRoot), 'supporting'),
  );
  const identity = options.identity || getAgentIdentity();
  resetRepositoryRoot(supportingRoot, identity);
  const prepared: PreparedSupportingRepository[] = [];
  for (const [index, config] of configs.entries()) {
    const repositoryRoot = path.join(supportingRoot, `repository-${index + 1}`);
    const supportingPayload: AgentRunnerPayload = {
      ...payload,
      changeContext: undefined,
      config: {
        branch: config.branch,
        folder: config.folder,
        repository: config.repository,
      },
      memory: undefined,
    };
    const workingDirectory = await cloneRepository(supportingPayload, {
      ...options,
      identity,
      repositoryRoot,
    });
    const head = await runGitData(
      options.runCommand || runProcess,
      repositoryRoot,
      ['rev-parse', '--verify', 'HEAD^{commit}'],
      {
        environment: createGitEnvironment(
          undefined,
          identity,
          options.environment,
        ),
        identity,
        label: `Git cloned head verification for ${config.repository}`,
      },
    );
    const headRevision = head.stdout.trim().toLowerCase();
    if (!GIT_OBJECT_ID_PATTERN.test(headRevision)) {
      throw new Error(
        `Git returned an invalid cloned head revision for ${config.repository}.`,
      );
    }
    makeTreeReadOnly(repositoryRoot);
    prepared.push({
      ...config,
      headRevision,
      repositoryRoot,
      workingDirectory,
    });
  }
  return prepared;
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getAgentIdentity(
  environment: NodeJS.ProcessEnv = process.env,
): AgentIdentity {
  return {
    gid: positiveInteger(environment.PLAYRUNNER_AGENT_GID, 1001),
    home: environment.PLAYRUNNER_AGENT_HOME || '/home/playrunner',
    uid: positiveInteger(environment.PLAYRUNNER_AGENT_UID, 1001),
  };
}

export function createGitEnvironment(
  token: string | undefined,
  identity: AgentIdentity,
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const sanitizedEnvironment = { ...environment };
  for (const key of Object.keys(sanitizedEnvironment)) {
    if (
      key === 'GIT_CONFIG_COUNT' ||
      key === 'GIT_CONFIG_PARAMETERS' ||
      /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key)
    ) {
      delete sanitizedEnvironment[key];
    }
  }
  const result = {
    ...sanitizedEnvironment,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    HOME: identity.home,
  };
  if (!token) return result;
  return {
    ...result,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(
      `x-access-token:${token}`,
      'utf8',
    ).toString('base64')}`,
  };
}

function assertSafeRepositoryRoot(repositoryRoot: string): string {
  const resolved = path.resolve(repositoryRoot);
  if (resolved === path.parse(resolved).root) {
    throw new Error(
      'AI Container repository root cannot be a filesystem root.',
    );
  }
  return resolved;
}

function resetRepositoryRoot(
  repositoryRoot: string,
  identity: AgentIdentity,
): void {
  fs.rmSync(repositoryRoot, { force: true, recursive: true });
  fs.mkdirSync(repositoryRoot, { recursive: true });
  fs.chownSync(repositoryRoot, identity.uid, identity.gid);
}

function resolveWorkingDirectory(
  payload: AgentRunnerPayload,
  repositoryRoot: string,
): string {
  const folder = String(payload.config.folder || '.');
  const workingDirectory = path.resolve(repositoryRoot, folder);
  let realRepositoryRoot = '';
  let realWorkingDirectory = '';
  try {
    realRepositoryRoot = fs.realpathSync(repositoryRoot);
    realWorkingDirectory = fs.realpathSync(workingDirectory);
  } catch {
    throw new Error(
      `Working folder does not exist in the repository: ${folder}`,
    );
  }
  if (
    (workingDirectory !== repositoryRoot &&
      !workingDirectory.startsWith(`${repositoryRoot}${path.sep}`)) ||
    (realWorkingDirectory !== realRepositoryRoot &&
      !realWorkingDirectory.startsWith(`${realRepositoryRoot}${path.sep}`)) ||
    !fs.statSync(realWorkingDirectory).isDirectory()
  ) {
    throw new Error(
      `Working folder must resolve to a directory inside the repository: ${folder}`,
    );
  }
  return workingDirectory;
}

function cloneFailure(result: ProcessResult): Error {
  return new Error(
    result.timedOut
      ? 'Git clone timed out after 10 minutes.'
      : `Git clone failed with code ${result.code}.`,
  );
}

async function runGitData(
  run: RunCommand,
  repositoryRoot: string,
  args: string[],
  options: {
    environment: NodeJS.ProcessEnv;
    identity: AgentIdentity;
    label: string;
    maxOutputBytes?: number;
  },
): Promise<ProcessResult> {
  const result = await run('git', args, {
    cwd: repositoryRoot,
    env: options.environment,
    gid: options.identity.gid,
    maxOutputBytes: options.maxOutputBytes || MAX_GIT_DATA_BYTES,
    timeoutMs: GIT_TIMEOUT_MS,
    uid: options.identity.uid,
  });
  if (result.timedOut) {
    throw new Error(`${options.label} timed out after 10 minutes.`);
  }
  if (result.code !== 0) {
    throw new Error(`${options.label} failed with code ${result.code}.`);
  }
  if (result.stdoutTruncated || result.stderrTruncated) {
    throw new Error(`${options.label} produced truncated Git output.`);
  }
  return result;
}

function isSafeRepositoryPath(value: string): boolean {
  const hasControlCharacter = Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  return (
    Boolean(value) &&
    Buffer.byteLength(value, 'utf8') <= MAX_REPOSITORY_PATH_BYTES &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !value.includes('\uFFFD') &&
    !hasControlCharacter &&
    path.posix.normalize(value) === value &&
    value !== '.' &&
    !value
      .split('/')
      .some((segment) => segment === '..' || segment.toLowerCase() === '.git')
  );
}

function assertRepositoryPath(value: string): string {
  if (!isSafeRepositoryPath(value)) {
    throw new Error('Git reported an unsafe changed repository path.');
  }
  return value;
}

function parseChangedFiles(output: string): RawChangedFile[] {
  if (!output) return [];
  if (!output.endsWith('\0')) {
    throw new Error('Git returned a malformed changed-file manifest.');
  }
  const tokens = output.slice(0, -1).split('\0');
  const files: RawChangedFile[] = [];
  for (let index = 0; index < tokens.length; ) {
    const statusToken = tokens[index++];
    let status: ChangeManifestFile['status'];
    let previousPath: string | undefined;
    if (statusToken === 'A') status = 'added';
    else if (statusToken === 'M') status = 'modified';
    else if (statusToken === 'D') status = 'deleted';
    else if (statusToken === 'T') status = 'type_changed';
    else if (
      /^R\d{1,3}$/.test(statusToken) &&
      Number(statusToken.slice(1)) <= 100
    ) {
      status = 'renamed';
      const previous = tokens[index++];
      if (previous === undefined) {
        throw new Error('Git returned a malformed rename entry.');
      }
      previousPath = assertRepositoryPath(previous);
    } else if (
      /^C\d{1,3}$/.test(statusToken) &&
      Number(statusToken.slice(1)) <= 100
    ) {
      status = 'copied';
      const previous = tokens[index++];
      if (previous === undefined) {
        throw new Error('Git returned a malformed copy entry.');
      }
      previousPath = assertRepositoryPath(previous);
    } else {
      throw new Error(
        `Git returned an unsupported change status: ${statusToken}`,
      );
    }
    const changedPath = tokens[index++];
    if (changedPath === undefined) {
      throw new Error('Git returned a malformed changed-file entry.');
    }
    files.push({
      path: assertRepositoryPath(changedPath),
      ...(previousPath ? { previousPath } : {}),
      status,
    });
    if (files.length > MAX_CHANGED_FILES) {
      throw new Error(
        `Change manifest exceeds the ${MAX_CHANGED_FILES} changed-file limit.`,
      );
    }
  }
  files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  for (let index = 1; index < files.length; index += 1) {
    if (files[index - 1].path === files[index].path) {
      throw new Error('Git returned duplicate changed-file entries.');
    }
  }
  return files;
}

function mergeLineRanges(ranges: ChangedLineRange[]): ChangedLineRange[] {
  const merged: ChangedLineRange[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + 1) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function parseChangedLineRanges(output: string): ChangedLineRange[] {
  const ranges: ChangedLineRange[] = [];
  for (const line of output.split('\n')) {
    if (!line.startsWith('@@')) continue;
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/.exec(
      line,
    );
    if (!match) {
      throw new Error('Git returned a malformed changed-line hunk.');
    }
    const start = Number(match[3]);
    const count = match[4] === undefined ? 1 : Number(match[4]);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(count) ||
      count < 0 ||
      (count > 0 && start < 1) ||
      (count > 0 && !Number.isSafeInteger(start + count - 1))
    ) {
      throw new Error('Git returned an invalid changed-line range.');
    }
    if (count > 0) ranges.push({ end: start + count - 1, start });
  }
  return mergeLineRanges(ranges);
}

export function classifyChangedPath(
  repositoryPath: string,
): ChangeManifestFile['classification'] {
  const lower = repositoryPath.toLowerCase();
  const basename = path.posix.basename(lower);
  const segments = lower.split('/');
  if (
    segments.some((segment) =>
      [
        '__tests__',
        '__snapshots__',
        'e2e',
        'fixtures',
        'integration-tests',
        'spec',
        'specs',
        'snapshots',
        'test',
        'test-data',
        'tests',
      ].includes(segment),
    ) ||
    /(?:^|[._-])(?:spec|test)\.[^.]+$/.test(basename) ||
    /^(?:spec|test)_[^.]+\.[^.]+$/.test(basename) ||
    /_[._-]?test\.[^.]+$/.test(basename) ||
    basename.endsWith('.snap')
  ) {
    return 'test';
  }
  if (
    segments.some((segment) =>
      [
        '.changeset',
        '.circleci',
        '.github',
        '.gitlab',
        'config',
        'docs',
        'infrastructure',
        'infra',
      ].includes(segment),
    ) ||
    basename.startsWith('.') ||
    /^(?:dockerfile(?:\..+)?|makefile)$/.test(basename) ||
    /(?:^|\.)(?:config|rc)\.[^.]+$/.test(basename) ||
    /^(?:eslint|prettier|tsconfig|vite|vitest|webpack)(?:\..+)?$/.test(
      basename,
    ) ||
    /^(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(basename) ||
    /\.(?:md|toml|ya?ml)$/.test(basename)
  ) {
    return 'config';
  }
  return 'production';
}

function parsePullRequestMergeBase(
  output: string,
  context: CiChangeContext,
): string {
  const lines = output.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  if (lines.length === 0 || (lines.length === 1 && !lines[0])) {
    throw new Error('Git could not resolve a pull request merge base.');
  }
  if (lines.length !== 1) {
    throw new Error('Git returned ambiguous pull request merge bases.');
  }
  const mergeBase = lines[0];
  if (
    !GIT_OBJECT_ID_PATTERN.test(mergeBase) ||
    context.baseSha.length !== context.headSha.length ||
    mergeBase.length !== context.headSha.length
  ) {
    throw new Error('Git returned a malformed pull request merge base.');
  }
  return mergeBase;
}

function assertRemotePushHead(output: string, context: CiChangeContext): void {
  const lines = output.trim() ? output.trim().split(/\r?\n/) : [];
  if (lines.length !== 1) {
    throw new Error(
      'Git could not resolve exactly one configured source branch for the push context.',
    );
  }
  const match = /^((?:[a-f0-9]{40}|[a-f0-9]{64}))\trefs\/heads\/(.+)$/i.exec(
    lines[0],
  );
  if (
    !match ||
    match[2] !== context.headRef ||
    match[1].length !== context.headSha.length
  ) {
    throw new Error(
      'Git returned an invalid configured source branch for the push context.',
    );
  }
  if (match[1].toLowerCase() !== context.headSha) {
    throw new Error(
      'Configured source branch does not resolve to changeContext.headSha.',
    );
  }
}

async function resolveManifestBase(
  run: RunCommand,
  repositoryRoot: string,
  context: CiChangeContext,
  environment: NodeJS.ProcessEnv,
  identity: AgentIdentity,
): Promise<string> {
  if (context.eventType !== 'pull_request') return context.baseSha;

  for (const [label, sha] of [
    ['base', context.baseSha],
    ['head', context.headSha],
  ] as const) {
    await runGitData(
      run,
      repositoryRoot,
      ['cat-file', '-e', `${sha}^{commit}`],
      {
        environment,
        identity,
        label: `Git pull request ${label} commit verification`,
        maxOutputBytes: 4_096,
      },
    );
  }

  const resolved = await runGitData(
    run,
    repositoryRoot,
    ['merge-base', '--all', context.baseSha, context.headSha],
    {
      environment,
      identity,
      label: 'Git pull request merge-base resolution',
      maxOutputBytes: 4_096,
    },
  );
  const mergeBase = parsePullRequestMergeBase(resolved.stdout, context);
  await runGitData(
    run,
    repositoryRoot,
    ['cat-file', '-e', `${mergeBase}^{commit}`],
    {
      environment,
      identity,
      label: 'Git pull request merge-base commit verification',
      maxOutputBytes: 4_096,
    },
  );
  for (const [label, descendant] of [
    ['base', context.baseSha],
    ['head', context.headSha],
  ] as const) {
    await runGitData(
      run,
      repositoryRoot,
      ['merge-base', '--is-ancestor', mergeBase, descendant],
      {
        environment,
        identity,
        label: `Git pull request merge-base ${label} ancestry verification`,
        maxOutputBytes: 4_096,
      },
    );
  }
  return mergeBase;
}

export async function createChangeManifest(
  repositoryRoot: string,
  unsafeContext: CiChangeContext,
  options: {
    environment?: NodeJS.ProcessEnv;
    identity?: AgentIdentity;
    runCommand?: RunCommand;
  } = {},
): Promise<ChangeManifest> {
  const context = normalizeCiChangeContext(unsafeContext);
  const identity = options.identity || getAgentIdentity();
  const environment = createGitEnvironment(
    undefined,
    identity,
    options.environment,
  );
  const run = options.runCommand || runProcess;
  const manifestBase = await resolveManifestBase(
    run,
    repositoryRoot,
    context,
    environment,
    identity,
  );
  const names = await runGitData(
    run,
    repositoryRoot,
    [
      'diff',
      '--name-status',
      '-z',
      '--find-renames=90%',
      '--find-copies=90%',
      manifestBase,
      context.headSha,
      '--',
    ],
    { environment, identity, label: 'Git changed-file inspection' },
  );
  const rawFiles = parseChangedFiles(names.stdout);
  const files: ChangeManifestFile[] = [];
  let totalDiffBytes = Buffer.byteLength(names.stdout, 'utf8');
  let totalChangedLines = 0;
  let totalLineRanges = 0;
  for (const file of rawFiles) {
    const diff = await runGitData(
      run,
      repositoryRoot,
      [
        'diff',
        '--unified=0',
        '--no-color',
        '--no-ext-diff',
        '--no-textconv',
        '--find-renames=90%',
        manifestBase,
        context.headSha,
        '--',
        `:(literal)${file.path}`,
      ],
      {
        environment,
        identity,
        label: `Git changed-line inspection for ${file.path}`,
      },
    );
    const diffBytes = Buffer.byteLength(diff.stdout, 'utf8');
    totalDiffBytes += diffBytes;
    if (totalDiffBytes > MAX_TOTAL_DIFF_BYTES) {
      throw new Error(
        `Change inspection exceeds the ${MAX_TOTAL_DIFF_BYTES} byte Git output limit.`,
      );
    }
    const changedLines = parseChangedLineRanges(diff.stdout);
    const changedLineCount = changedLines.reduce(
      (total, range) => total + (range.end - range.start + 1),
      0,
    );
    totalChangedLines += changedLineCount;
    totalLineRanges += changedLines.length;
    if (totalChangedLines > MAX_CHANGED_LINES) {
      throw new Error(
        `Change manifest exceeds the ${MAX_CHANGED_LINES} changed-line limit.`,
      );
    }
    if (totalLineRanges > MAX_CHANGED_LINE_RANGES) {
      throw new Error(
        `Change manifest exceeds the ${MAX_CHANGED_LINE_RANGES} changed-line-range limit.`,
      );
    }
    files.push({
      binary:
        /^Binary files .* differ$/m.test(diff.stdout) ||
        /^GIT binary patch$/m.test(diff.stdout),
      changedLineCount,
      changedLines,
      classification: classifyChangedPath(file.path),
      path: file.path,
      ...(file.previousPath ? { previousPath: file.previousPath } : {}),
      status: file.status,
    });
  }
  const countFiles = (classification: ChangeManifestFile['classification']) =>
    files.filter((file) => file.classification === classification).length;
  const countLines = (classification: ChangeManifestFile['classification']) =>
    files
      .filter((file) => file.classification === classification)
      .reduce((total, file) => total + file.changedLineCount, 0);
  const manifest: ChangeManifest = {
    context,
    files,
    schemaVersion: CHANGE_MANIFEST_SCHEMA_VERSION,
    summary: {
      changedFiles: files.length,
      changedLines: totalChangedLines,
      configChangedLines: countLines('config'),
      configFiles: countFiles('config'),
      productionChangedLines: countLines('production'),
      productionFiles: countFiles('production'),
      testChangedLines: countLines('test'),
      testFiles: countFiles('test'),
    },
  };
  const manifestBytes = Buffer.byteLength(JSON.stringify(manifest), 'utf8');
  if (manifestBytes > MAX_CHANGE_MANIFEST_BYTES) {
    throw new Error(
      `Change manifest exceeds the ${MAX_CHANGE_MANIFEST_BYTES} byte materialization limit.`,
    );
  }
  return manifest;
}

export async function cloneRepository(
  payload: AgentRunnerPayload,
  options: RepositoryOptions = {},
): Promise<string> {
  const identity = options.identity || getAgentIdentity();
  const repositoryRoot = assertSafeRepositoryRoot(
    options.repositoryRoot || '/workspace/repo',
  );
  const repository = normalizeGitHubRepository(payload.config.repository);
  const branch = String(payload.config.branch || 'main').trim() || 'main';
  resetRepositoryRoot(repositoryRoot, identity);
  console.log(`[AI Container] Cloning ${repository} (${branch}).`);
  const run = options.runCommand || runProcess;
  const clone = await run(
    'git',
    [
      'clone',
      '--depth',
      '1',
      '--branch',
      branch,
      '--single-branch',
      `https://github.com/${repository}.git`,
      repositoryRoot,
    ],
    {
      env: createGitEnvironment(
        payload.github?.accessToken,
        identity,
        options.environment,
      ),
      gid: identity.gid,
      maxOutputBytes: 1_000_000,
      stream: true,
      timeoutMs: GIT_TIMEOUT_MS,
      uid: identity.uid,
    },
  );
  if (clone.code !== 0 || clone.timedOut) throw cloneFailure(clone);
  return resolveWorkingDirectory(payload, repositoryRoot);
}

async function prepareCiRepository(
  payload: AgentRunnerPayload,
  context: CiChangeContext,
  options: RepositoryOptions,
): Promise<PreparedRepository> {
  const identity = options.identity || getAgentIdentity();
  const repositoryRoot = assertSafeRepositoryRoot(
    options.repositoryRoot || '/workspace/repo',
  );
  const repository = normalizeGitHubRepository(payload.config.repository);
  if (repository.toLowerCase() !== context.repository.toLowerCase()) {
    throw new Error(
      'AI Container changeContext.repository does not match config.repository.',
    );
  }
  if (
    payload.memory &&
    repository.toLowerCase() !== payload.memory.repository.toLowerCase()
  ) {
    throw new Error(
      'AI Container memory.repository does not match config.repository.',
    );
  }
  resetRepositoryRoot(repositoryRoot, identity);
  console.log(
    `[AI Container] Cloning ${repository} at immutable head ${context.headSha}.`,
  );
  const run = options.runCommand || runProcess;
  const environment = createGitEnvironment(
    payload.github?.accessToken,
    identity,
    options.environment,
  );
  const inspectionEnvironment = createGitEnvironment(
    undefined,
    identity,
    options.environment,
  );
  const clone = await run(
    'git',
    [
      'clone',
      '--depth',
      '1',
      '--no-checkout',
      `https://github.com/${repository}.git`,
      repositoryRoot,
    ],
    {
      env: environment,
      gid: identity.gid,
      maxOutputBytes: 1_000_000,
      stream: true,
      timeoutMs: GIT_TIMEOUT_MS,
      uid: identity.uid,
    },
  );
  if (clone.code !== 0 || clone.timedOut) throw cloneFailure(clone);
  const fetchDepth =
    context.eventType === 'pull_request' ? MAX_PULL_REQUEST_HISTORY_DEPTH : 1;
  for (const sha of new Set([context.headSha, context.baseSha])) {
    await runGitData(
      run,
      repositoryRoot,
      ['fetch', '--no-tags', '--depth', String(fetchDepth), 'origin', sha],
      {
        environment,
        identity,
        label: `Git fetch for immutable commit ${sha}`,
      },
    );
    await runGitData(
      run,
      repositoryRoot,
      ['cat-file', '-e', `${sha}^{commit}`],
      {
        environment: inspectionEnvironment,
        identity,
        label: `Git commit verification for ${sha}`,
      },
    );
  }
  await runGitData(
    run,
    repositoryRoot,
    ['checkout', '--detach', '--force', context.headSha],
    {
      environment: inspectionEnvironment,
      identity,
      label: 'Git immutable head checkout',
    },
  );
  const head = await runGitData(
    run,
    repositoryRoot,
    ['rev-parse', '--verify', 'HEAD^{commit}'],
    {
      environment: inspectionEnvironment,
      identity,
      label: 'Git immutable head verification',
    },
  );
  const headRevision = head.stdout.trim().toLowerCase();
  if (headRevision !== context.headSha) {
    throw new Error(
      'Git checked out a different commit than changeContext.headSha.',
    );
  }
  const workingDirectory = resolveWorkingDirectory(payload, repositoryRoot);
  const changeManifest = await createChangeManifest(repositoryRoot, context, {
    environment: inspectionEnvironment,
    identity,
    runCommand: run,
  });
  if (context.eventType === 'push') {
    const remoteHead = await runGitData(
      run,
      repositoryRoot,
      ['ls-remote', '--heads', 'origin', `refs/heads/${context.headRef}`],
      {
        environment,
        identity,
        label: 'Git trusted push branch verification',
        maxOutputBytes: 4_096,
      },
    );
    assertRemotePushHead(remoteHead.stdout, context);
  }
  return {
    changeContext: context,
    changeManifest,
    headRevision,
    repositoryRoot,
    workingDirectory,
  };
}

export async function prepareRepository(
  payload: AgentRunnerPayload,
  options: RepositoryOptions = {},
): Promise<PreparedRepository> {
  if (payload.changeContext) {
    const context = normalizeCiChangeContext(payload.changeContext);
    const primary = await prepareCiRepository(payload, context, options);
    const supportingRepositories = await prepareSupportingRepositories(
      payload,
      primary.repositoryRoot,
      options,
    );
    return {
      ...primary,
      ...(supportingRepositories.length ? { supportingRepositories } : {}),
    };
  }
  const repository = normalizeGitHubRepository(payload.config.repository);
  if (
    payload.memory &&
    repository.toLowerCase() !== payload.memory.repository.toLowerCase()
  ) {
    throw new Error(
      'AI Container memory.repository does not match config.repository.',
    );
  }
  const workingDirectory = await cloneRepository(payload, options);
  const identity = options.identity || getAgentIdentity();
  const repositoryRoot = assertSafeRepositoryRoot(
    options.repositoryRoot || '/workspace/repo',
  );
  const head = await runGitData(
    options.runCommand || runProcess,
    repositoryRoot,
    ['rev-parse', '--verify', 'HEAD^{commit}'],
    {
      environment: createGitEnvironment(
        undefined,
        identity,
        options.environment,
      ),
      identity,
      label: 'Git cloned head verification',
    },
  );
  const headRevision = head.stdout.trim().toLowerCase();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(headRevision)) {
    throw new Error('Git returned an invalid cloned head revision.');
  }
  const supportingRepositories = await prepareSupportingRepositories(
    payload,
    repositoryRoot,
    options,
  );
  return {
    headRevision,
    repositoryRoot,
    ...(supportingRepositories.length ? { supportingRepositories } : {}),
    workingDirectory,
  };
}
