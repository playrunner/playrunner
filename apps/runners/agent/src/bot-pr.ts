import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { runProcess, type ProcessResult } from './process';
import {
  createGitEnvironment,
  getAgentIdentity,
  type AgentIdentity,
} from './repository';
import {
  assertNoProhibitedExactValues,
  containsProhibitedExactValue,
  normalizeProhibitedExactValues,
} from './secret-values';

export const MAX_BOT_PR_CHANGED_FILES = 100;
export const MAX_BOT_PR_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_BOT_PR_TOTAL_BYTES = 10 * 1024 * 1024;

const MAX_GIT_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_GITHUB_RESPONSE_BYTES = 1024 * 1024;
const MAX_SOURCE_WORKFLOW_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_WORKFLOW_FILE_BYTES = 512 * 1024;
const MAX_SOURCE_WORKFLOW_FILES = 100;
const MAX_PATH_BYTES = 1024;
const GIT_TIMEOUT_MS = 60_000;
const NETWORK_TIMEOUT_MS = 30_000;
const BOT_NAME = 'Playrunner Test Bot';
const BOT_EMAIL = 'test-bot@playrunner.dev';
const GITHUB_API_ORIGIN = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const HARDENED_GIT_ARGUMENTS = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'credential.helper=',
  '-c',
  'protocol.file.allow=never',
] as const;

type ProcessRunner = (
  command: string,
  args: string[],
  options: Parameters<typeof runProcess>[2],
) => Promise<ProcessResult>;

export type BotPrFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type BotPrDeliveryOptions = {
  cwd: string;
  developerHeadRef: string;
  developerHeadSha: string;
  botIdentity?: AgentIdentity;
  environment?: NodeJS.ProcessEnv;
  executionId: string;
  fetcher?: BotPrFetcher;
  forkRepository: string;
  githubToken: string;
  identity?: AgentIdentity;
  nodeId: string;
  prohibitedExactValues?: readonly string[];
  repository: string;
  runCommand?: ProcessRunner;
  workflowId: string;
};

export type BotPullRequestMetadata = {
  baseRef: string;
  draft: true;
  headRef: string;
  number: number;
  title: string;
  url: string;
};

export type BotPrDeliveryResult =
  | {
      changedFiles: string[];
      developerHeadSha: string;
      generatedTestFiles: string[];
      status: 'no_changes';
    }
  | {
      branchName: string;
      changedFiles: string[];
      commitSha: string;
      developerHeadSha: string;
      generatedTestFiles: string[];
      pullRequest: BotPullRequestMetadata;
      status: 'created' | 'existing';
    };

type ChangedFile = {
  path: string;
  status: string;
};

type ValidatedChangedFile = {
  blobObjectId: string;
  contents: Buffer;
  path: string;
};

type DeliveryContext = {
  baseEnvironment: NodeJS.ProcessEnv;
  cwd: string;
  identity: AgentIdentity;
  runCommand: ProcessRunner;
};

type GitHubResponse = {
  body: unknown;
  status: number;
};

type VerifiedPublicRepositories = {
  forkOwner: string;
  forkRepository: string;
  sourceDefaultBranch: string;
  sourceRepository: string;
};

function requiredIdentifier(value: string, field: string): string {
  const normalized = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(normalized)) {
    throw new Error(`Bot PR ${field} must be a safe identifier.`);
  }
  return normalized;
}

function normalizeRepository(value: string): {
  name: string;
  owner: string;
  repository: string;
} {
  const repository = String(value || '')
    .trim()
    .replace(/\.git$/i, '');
  const match =
    /^([A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99}))\/([A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99}))$/.exec(
      repository,
    );
  if (!match || match[1] === '.' || match[1] === '..') {
    throw new Error('Bot PR repository must use owner/repository form.');
  }
  return { name: match[2], owner: match[1], repository };
}

function normalizeHeadSha(value: string): string {
  const sha = String(value || '')
    .trim()
    .toLowerCase();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha)) {
    throw new Error('Bot PR developerHeadSha must be an exact Git commit SHA.');
  }
  return sha;
}

function normalizeHeadRef(value: string): string {
  let ref = String(value || '').trim();
  if (ref.startsWith('refs/heads/')) ref = ref.slice('refs/heads/'.length);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/.test(ref) ||
    ref.includes('..') ||
    ref.includes('//') ||
    ref.includes('@{') ||
    ref.endsWith('/') ||
    ref.endsWith('.') ||
    ref.endsWith('.lock') ||
    ref
      .split('/')
      .some(
        (segment) =>
          !segment || segment.startsWith('.') || segment.endsWith('.lock'),
      )
  ) {
    throw new Error('Bot PR developerHeadRef must be a safe branch name.');
  }
  return ref;
}

function normalizeToken(value: string): string {
  const token = String(value || '').trim();
  if (
    !token ||
    Buffer.byteLength(token, 'utf8') > 4096 ||
    Array.from(token).some((character) => {
      const code = character.charCodeAt(0);
      return code < 33 || code > 126;
    })
  ) {
    throw new Error('Bot PR requires a valid GitHub token.');
  }
  return token;
}

function cleanGitEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const cleaned: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(environment)) {
    if (key === 'EMAIL' || /^GIT_/i.test(key)) {
      continue;
    }
    cleaned[key] = value;
  }
  return cleaned;
}

function currentBotIdentity(): AgentIdentity {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (uid !== 0 || gid === undefined) {
    throw new Error(
      'Bot PR delivery requires the container main process to run as root so GitHub credentials remain isolated from the untrusted agent UID.',
    );
  }
  return { gid, home: os.homedir(), uid };
}

function assertIsolatedBotIdentity(
  botIdentity: AgentIdentity,
  agentIdentity: AgentIdentity,
): void {
  if (
    !Number.isInteger(botIdentity.uid) ||
    botIdentity.uid < 0 ||
    !Number.isInteger(botIdentity.gid) ||
    botIdentity.gid < 0 ||
    !path.isAbsolute(botIdentity.home) ||
    botIdentity.uid === agentIdentity.uid
  ) {
    throw new Error(
      'Bot PR delivery requires a privileged bot identity distinct from the untrusted agent UID.',
    );
  }
}

function botGitEnvironment(identity: AgentIdentity): NodeJS.ProcessEnv {
  return createGitEnvironment(undefined, identity, {
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  });
}

function buildBranchName(
  repository: string,
  workflowId: string,
  developerHeadSha: string,
  nodeId: string,
): string {
  const discriminator = crypto
    .createHash('sha256')
    .update(repository.toLowerCase())
    .update('\0')
    .update(workflowId)
    .update('\0')
    .update(developerHeadSha)
    .update('\0')
    .update(nodeId)
    .digest('hex')
    .slice(0, 16);
  return `playrunner/tests/${developerHeadSha.slice(0, 12)}-${discriminator}`;
}

function checkedOutput(result: ProcessResult, operation: string): string {
  if (result.timedOut) throw new Error(`Bot PR ${operation} timed out.`);
  if (result.stdoutTruncated || result.stderrTruncated) {
    throw new Error(`Bot PR ${operation} exceeded its output limit.`);
  }
  if (result.code !== 0) {
    throw new Error(`Bot PR ${operation} failed with code ${result.code}.`);
  }
  return result.stdout;
}

async function runGit(
  context: DeliveryContext,
  args: string[],
  operation: string,
  options: {
    authenticatedEnvironment?: NodeJS.ProcessEnv;
    maxOutputBytes?: number;
  } = {},
): Promise<string> {
  const result = await context.runCommand(
    'git',
    [...HARDENED_GIT_ARGUMENTS, ...args],
    {
      cwd: context.cwd,
      env: options.authenticatedEnvironment || context.baseEnvironment,
      gid: context.identity.gid,
      maxOutputBytes: options.maxOutputBytes || MAX_GIT_OUTPUT_BYTES,
      timeoutMs: GIT_TIMEOUT_MS,
      uid: context.identity.uid,
    },
  );
  return checkedOutput(result, operation);
}

async function resolveRepositoryRoot(
  context: DeliveryContext,
): Promise<string> {
  const cwd = fs.realpathSync(context.cwd);
  const output = await runGit(
    { ...context, cwd },
    ['rev-parse', '--show-toplevel'],
    'repository discovery',
    { maxOutputBytes: 4096 },
  );
  const candidate = output.trim();
  if (!candidate || !path.isAbsolute(candidate) || candidate.includes('\0')) {
    throw new Error('Bot PR could not resolve a safe repository root.');
  }
  const root = fs.realpathSync(candidate);
  if (cwd !== root && !cwd.startsWith(`${root}${path.sep}`)) {
    throw new Error('Bot PR working directory is outside the repository root.');
  }
  return root;
}

async function assertSafeRepositoryGitConfig(
  context: DeliveryContext,
): Promise<void> {
  const result = await context.runCommand(
    'git',
    [
      ...HARDENED_GIT_ARGUMENTS,
      'config',
      '--local',
      '--includes',
      '--name-only',
      '--list',
    ],
    {
      cwd: context.cwd,
      env: context.baseEnvironment,
      gid: context.identity.gid,
      maxOutputBytes: 64 * 1024,
      timeoutMs: GIT_TIMEOUT_MS,
      uid: context.identity.uid,
    },
  );
  if (result.timedOut) {
    throw new Error('Bot PR repository Git configuration check timed out.');
  }
  if (result.stdoutTruncated || result.stderrTruncated) {
    throw new Error(
      'Bot PR repository Git configuration exceeded its output limit.',
    );
  }
  const forbidden = result.stdout
    .split(/\r?\n/)
    .map((value) => value.trim().toLowerCase())
    .find(
      (key) =>
        /^(?:alias|browser|credential|diff|difftool|filter|gpg|help|http|include|includeif|interactive|man|merge|mergetool|pack|pager|protocol|receive|sendemail|sequence|submodule|tar|uploadpack|url)\./.test(
          key,
        ) ||
        /^core\.(?:alternaterefscommand|askpass|attributesfile|editor|fsmonitor|gitproxy|hookspath|pager|sshcommand|worktree)$/.test(
          key,
        ) ||
        /^remote\..+\.(?:proxy|proxyauthmethod|receivepack|uploadpack|vcs)$/.test(
          key,
        ),
    );
  if (forbidden) {
    throw new Error(
      `Bot PR refuses executable or network-sensitive local Git configuration: ${forbidden}`,
    );
  }
  if (result.code !== 0 && result.code !== 1) {
    throw new Error('Bot PR could not verify repository Git configuration.');
  }
}

async function assertNoPrivilegedWorkflowAtDeveloperHead(
  context: DeliveryContext,
  developerHeadSha: string,
): Promise<void> {
  const workflowOutput = await runGit(
    context,
    [
      'ls-tree',
      '-r',
      '-z',
      '--name-only',
      developerHeadSha,
      '--',
      '.github/workflows',
    ],
    'listing source workflows',
    { maxOutputBytes: 64 * 1024 },
  );
  const workflowPaths = parseNulPaths(workflowOutput).filter((workflowPath) =>
    /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(workflowPath),
  );
  if (workflowPaths.length > MAX_SOURCE_WORKFLOW_FILES) {
    throw new Error(
      `Bot PR source has too many workflow files to inspect safely (maximum ${MAX_SOURCE_WORKFLOW_FILES}).`,
    );
  }
  let totalBytes = 0;
  for (const workflowPath of workflowPaths) {
    const contents = await runGit(
      context,
      ['show', `${developerHeadSha}:${workflowPath}`],
      `reading source workflow ${workflowPath}`,
      { maxOutputBytes: MAX_SOURCE_WORKFLOW_FILE_BYTES },
    );
    const bytes = Buffer.from(contents, 'utf8');
    totalBytes += bytes.length;
    if (totalBytes > MAX_SOURCE_WORKFLOW_BYTES) {
      throw new Error(
        `Bot PR source workflows exceed the ${MAX_SOURCE_WORKFLOW_BYTES}-byte inspection limit.`,
      );
    }
    assertSafeWorkflowContents(bytes, workflowPath);
  }
}

function parseStatus(output: string): ChangedFile[] {
  if (!output) return [];
  const records = output.split('\0');
  if (records.at(-1) === '') records.pop();
  const files: ChangedFile[] = [];
  for (const record of records) {
    if (record.length < 4 || record[2] !== ' ') {
      throw new Error('Bot PR received malformed Git status output.');
    }
    const status = record.slice(0, 2);
    if (status !== '??' && (!/^[ AM][ AM]$/.test(status) || status === '  ')) {
      throw new Error(
        `Bot PR cannot deliver Git status ${JSON.stringify(status)}.`,
      );
    }
    files.push({ path: record.slice(3), status });
  }
  return files;
}

function validateRelativePath(value: string): string {
  if (
    !value ||
    path.posix.isAbsolute(value) ||
    value.includes('\\') ||
    value.includes(':') ||
    value.includes('\uFFFD') ||
    Buffer.byteLength(value, 'utf8') > MAX_PATH_BYTES ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw new Error('Bot PR encountered an unsafe changed-file path.');
  }
  const segments = value.split('/');
  if (
    path.posix.normalize(value) !== value ||
    segments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..' ||
        segment.toLowerCase() === '.git' ||
        segment.startsWith(' ') ||
        segment.endsWith(' '),
    )
  ) {
    throw new Error('Bot PR encountered an unsafe changed-file path.');
  }
  return value;
}

function isSensitiveTestPath(relativePath: string): boolean {
  return relativePath.split('/').some((segment) => {
    const value = segment.toLowerCase();
    return (
      value === '.auth' ||
      value === '.npmrc' ||
      value === '.pypirc' ||
      value === 'id_rsa' ||
      value === 'id_ed25519' ||
      value === 'storage-state.json' ||
      value.startsWith('.env') ||
      /\.(?:jks|key|p12|pem|pfx)$/.test(value)
    );
  });
}

const TEST_DIRECTORY_NAMES = new Set([
  '__snapshots__',
  '__tests__',
  'e2e',
  'integration-test',
  'integration-tests',
  'spec',
  'specs',
  'test',
  'tests',
]);

function isTestFile(relativePath: string): boolean {
  const segments = relativePath.toLowerCase().split('/');
  const basename = segments.at(-1) || '';
  return (
    segments.some((segment) => TEST_DIRECTORY_NAMES.has(segment)) ||
    /\.(?:e2e|spec|test)\.(?:[cm]?[jt]sx?|c|cc|cpp|cs|go|java|kt|kts|php|py|rb|rs|scala|sh|swift)$/.test(
      basename,
    )
  );
}

function isGeneratedTestFile(relativePath: string): boolean {
  const basename = path.posix.basename(relativePath).toLowerCase();
  return (
    /\.(?:e2e|spec|test)\.(?:[cm]?[jt]sx?|c|cc|cpp|cs|go|java|kt|kts|php|py|rb|rs|scala|sh|swift)$/.test(
      basename,
    ) ||
    /^(?:test_.+|.+_test)\.py$/.test(basename) ||
    /_test\.go$/.test(basename)
  );
}

function isApprovedConfig(relativePath: string): boolean {
  const basename = path.posix.basename(relativePath).toLowerCase();
  return (
    /^(?:c8|coverage|jest|playwright|vitest)\.config\.(?:[cm]?[jt]s|json)$/.test(
      basename,
    ) || /^\.nycrc(?:\.(?:json|ya?ml))?$/.test(basename)
  );
}

function isPackageManifest(relativePath: string): boolean {
  return path.posix.basename(relativePath).toLowerCase() === 'package.json';
}

function isPackageLockfile(relativePath: string): boolean {
  return /^(?:bun\.lockb?|npm-shrinkwrap\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(
    path.posix.basename(relativePath).toLowerCase(),
  );
}

function assertAllowedPath(relativePath: string): void {
  if (isSensitiveTestPath(relativePath)) {
    throw new Error(
      `Bot PR refuses to deliver a potentially sensitive file: ${relativePath}`,
    );
  }
  if (isPackageManifest(relativePath) || isPackageLockfile(relativePath)) {
    throw new Error(
      `Bot PR dependency manifests and lockfiles are not allowed: ${relativePath}`,
    );
  }
  if (!isTestFile(relativePath) && !isApprovedConfig(relativePath)) {
    throw new Error(
      `Bot PR changes must be limited to tests and approved test configuration: ${relativePath}`,
    );
  }
}

function assertRegularFileInsideRoot(
  root: string,
  relativePath: string,
): number {
  let current = root;
  for (const segment of relativePath.split('/')) {
    current = path.join(current, segment);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch {
      throw new Error(`Bot PR changed file does not exist: ${relativePath}`);
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Bot PR refuses symbolic links: ${relativePath}`);
    }
  }
  const stat = fs.statSync(current);
  if (!stat.isFile()) {
    throw new Error(`Bot PR only accepts regular files: ${relativePath}`);
  }
  const realFile = fs.realpathSync(current);
  if (!realFile.startsWith(`${root}${path.sep}`)) {
    throw new Error(
      `Bot PR changed file escapes the repository: ${relativePath}`,
    );
  }
  if (stat.size > MAX_BOT_PR_FILE_BYTES) {
    throw new Error(`Bot PR changed file is too large: ${relativePath}`);
  }
  return stat.size;
}

function readValidatedFileSnapshot(
  root: string,
  relativePath: string,
  objectFormat: 'sha1' | 'sha256',
  prohibitedExactValues: readonly string[],
): ValidatedChangedFile {
  const expectedSize = assertRegularFileInsideRoot(root, relativePath);
  const filename = path.join(root, relativePath);
  const descriptor = fs.openSync(
    filename,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  let contents: Buffer;
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > MAX_BOT_PR_FILE_BYTES) {
      throw new Error(
        `Bot PR only accepts bounded regular files: ${relativePath}`,
      );
    }
    contents = fs.readFileSync(descriptor);
    if (stat.size !== expectedSize || contents.length !== stat.size) {
      throw new Error(
        `Bot PR changed file was modified during validation: ${relativePath}`,
      );
    }
  } finally {
    fs.closeSync(descriptor);
  }
  if (containsProhibitedExactValue(contents, prohibitedExactValues)) {
    throw new Error(
      'Bot PR changed files contain a prohibited credential value.',
    );
  }
  const header = Buffer.from(`blob ${contents.length}\0`, 'utf8');
  const blobObjectId = crypto
    .createHash(objectFormat)
    .update(header)
    .update(contents)
    .digest('hex');
  return { blobObjectId, contents, path: relativePath };
}

async function validateChangedFiles(
  context: DeliveryContext,
  root: string,
  developerHeadSha: string,
  files: ChangedFile[],
  prohibitedExactValues: readonly string[],
): Promise<ValidatedChangedFile[]> {
  if (files.length > MAX_BOT_PR_CHANGED_FILES) {
    throw new Error(
      `Bot PR has too many changed files (maximum ${MAX_BOT_PR_CHANGED_FILES}).`,
    );
  }
  const snapshots: ValidatedChangedFile[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  const objectFormat = developerHeadSha.length === 64 ? 'sha256' : 'sha1';
  for (const file of files) {
    const relativePath = validateRelativePath(file.path);
    assertNoProhibitedExactValues(relativePath, prohibitedExactValues);
    if (seen.has(relativePath)) {
      throw new Error(
        `Bot PR contains a duplicate changed path: ${relativePath}`,
      );
    }
    seen.add(relativePath);
    assertAllowedPath(relativePath);
    const snapshot = readValidatedFileSnapshot(
      root,
      relativePath,
      objectFormat,
      prohibitedExactValues,
    );
    totalBytes += snapshot.contents.length;
    if (totalBytes > MAX_BOT_PR_TOTAL_BYTES) {
      throw new Error(
        `Bot PR changed files exceed ${MAX_BOT_PR_TOTAL_BYTES} bytes.`,
      );
    }
    snapshots.push(snapshot);
  }

  return snapshots.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

function parseNulPaths(output: string): string[] {
  const values = output.split('\0');
  if (values.at(-1) === '') values.pop();
  return values.map(validateRelativePath).sort();
}

function assertSamePaths(
  expected: string[],
  actual: string[],
  message = 'Bot PR staged files changed during delivery.',
): void {
  if (!isDeepStrictEqual(expected, actual)) {
    throw new Error(message);
  }
}

function assertRegularIndexEntries(
  output: string,
  expectedFiles: ValidatedChangedFile[],
) {
  const entries = output.split('\0');
  if (entries.at(-1) === '') entries.pop();
  const actualPaths: string[] = [];
  const expectedByPath = new Map(
    expectedFiles.map((file) => [file.path, file] as const),
  );
  for (const entry of entries) {
    const match =
      /^(100644|100755) ((?:[a-f0-9]{40}|[a-f0-9]{64})) 0\t(.+)$/.exec(entry);
    if (!match) {
      throw new Error(
        'Bot PR staged content includes a link or non-file entry.',
      );
    }
    const relativePath = validateRelativePath(match[3]);
    const expected = expectedByPath.get(relativePath);
    if (!expected || match[3] !== expected.path) {
      throw new Error('Bot PR staged files changed during delivery.');
    }
    const objectId = match[2];
    if (objectId !== expected.blobObjectId) {
      throw new Error(
        `Bot PR staged content differs from its validated snapshot: ${relativePath}`,
      );
    }
    actualPaths.push(relativePath);
  }
  assertSamePaths(
    expectedFiles.map((file) => file.path),
    actualPaths.sort(),
  );
}

function assertRegularCommitEntries(
  output: string,
  expectedFiles: ValidatedChangedFile[],
): void {
  const entries = output.split('\0');
  if (entries.at(-1) === '') entries.pop();
  const expectedByPath = new Map(
    expectedFiles.map((file) => [file.path, file] as const),
  );
  const actualPaths: string[] = [];
  for (const entry of entries) {
    const match =
      /^(100644|100755) blob ((?:[a-f0-9]{40}|[a-f0-9]{64}))\t(.+)$/.exec(
        entry,
      );
    if (!match) {
      throw new Error('Bot PR commit includes a link or non-file entry.');
    }
    const relativePath = validateRelativePath(match[3]);
    const expected = expectedByPath.get(relativePath);
    if (!expected || match[2] !== expected.blobObjectId) {
      throw new Error(
        `Bot PR commit differs from its validated snapshot: ${relativePath}`,
      );
    }
    actualPaths.push(relativePath);
  }
  assertSamePaths(
    expectedFiles.map((file) => file.path),
    actualPaths.sort(),
  );
}

async function assertCommitMatchesValidatedFiles(
  context: DeliveryContext,
  developerHeadSha: string,
  commitSha: string,
  files: ValidatedChangedFile[],
): Promise<void> {
  const expectedPaths = files.map((file) => file.path);
  const changedPaths = parseNulPaths(
    await runGit(
      context,
      [
        'diff-tree',
        '--no-commit-id',
        '--name-only',
        '-r',
        '-z',
        '--no-renames',
        developerHeadSha,
        commitSha,
        '--',
      ],
      'checking committed paths',
    ),
  );
  assertSamePaths(
    expectedPaths,
    changedPaths,
    'Bot PR commit changed paths after staged validation.',
  );
  const entries = await runGit(
    context,
    ['ls-tree', '-r', '-z', commitSha, '--', ...expectedPaths],
    'checking committed file modes and content',
  );
  assertRegularCommitEntries(entries, files);
}

async function stageAndCommit(
  context: DeliveryContext,
  files: ValidatedChangedFile[],
  branchName: string,
  developerHeadSha: string,
): Promise<string> {
  const paths = files.map((file) => file.path);
  await runGit(
    context,
    ['switch', '--create', branchName, developerHeadSha],
    'creating the bot branch',
  );
  await runGit(context, ['add', '--', ...paths], 'staging generated tests');

  for (const relativePath of paths) {
    assertRegularFileInsideRoot(context.cwd, relativePath);
  }

  const stagedPaths = parseNulPaths(
    await runGit(
      context,
      ['diff', '--cached', '--name-only', '--no-renames', '-z', '--'],
      'checking staged paths',
    ),
  );
  assertSamePaths(paths, stagedPaths);
  const indexEntries = await runGit(
    context,
    ['ls-files', '--stage', '-z', '--', ...paths],
    'checking staged file modes',
  );
  assertRegularIndexEntries(indexEntries, files);
  await runGit(
    context,
    ['diff', '--cached', '--check', '--'],
    'checking the staged patch',
  );

  const quiet = await context.runCommand(
    'git',
    [...HARDENED_GIT_ARGUMENTS, 'diff', '--cached', '--quiet', '--'],
    {
      cwd: context.cwd,
      env: context.baseEnvironment,
      gid: context.identity.gid,
      maxOutputBytes: 4096,
      timeoutMs: GIT_TIMEOUT_MS,
      uid: context.identity.uid,
    },
  );
  if (quiet.timedOut) throw new Error('Bot PR staged-patch check timed out.');
  if (quiet.code === 0) {
    throw new Error('Bot PR changed files produced no staged patch.');
  }
  if (quiet.code !== 1) {
    throw new Error('Bot PR could not verify the staged patch.');
  }

  const commitEnvironment = {
    ...context.baseEnvironment,
    GIT_AUTHOR_EMAIL: BOT_EMAIL,
    GIT_AUTHOR_NAME: BOT_NAME,
    GIT_COMMITTER_EMAIL: BOT_EMAIL,
    GIT_COMMITTER_NAME: BOT_NAME,
  };
  await runGit(
    context,
    [
      '-c',
      `user.name=${BOT_NAME}`,
      '-c',
      `user.email=${BOT_EMAIL}`,
      '-c',
      'commit.gpgSign=false',
      'commit',
      '--no-gpg-sign',
      '--no-verify',
      '-m',
      `test: generate coverage for ${developerHeadSha}`,
    ],
    'committing generated tests',
    { authenticatedEnvironment: commitEnvironment },
  );
  const commitSha = (
    await runGit(context, ['rev-parse', 'HEAD'], 'reading the bot commit', {
      maxOutputBytes: 4096,
    })
  )
    .trim()
    .toLowerCase();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commitSha)) {
    throw new Error('Bot PR produced an invalid commit SHA.');
  }
  const parentSha = (
    await runGit(
      context,
      ['rev-parse', `${commitSha}^`],
      'checking the bot commit parent',
      { maxOutputBytes: 4096 },
    )
  )
    .trim()
    .toLowerCase();
  if (parentSha !== developerHeadSha) {
    throw new Error(
      'Bot PR commit is not based on the requested developer SHA.',
    );
  }
  await assertCommitMatchesValidatedFiles(
    context,
    developerHeadSha,
    commitSha,
    files,
  );
  const remaining = parseStatus(
    await runGit(
      context,
      [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
        '--no-renames',
      ],
      'checking the committed workspace',
    ),
  );
  if (remaining.length) {
    throw new Error('Bot PR workspace changed while the commit was created.');
  }
  return commitSha;
}

function parseRemoteBranchSha(output: string, branchName: string): string {
  if (!output.trim()) return '';
  const lines = output.trim().split(/\r?\n/);
  if (lines.length !== 1) {
    throw new Error('Bot PR remote branch lookup was ambiguous.');
  }
  const match = /^((?:[a-f0-9]{40}|[a-f0-9]{64}))\trefs\/heads\/(.+)$/i.exec(
    lines[0],
  );
  if (!match || match[2] !== branchName) {
    throw new Error('Bot PR remote branch lookup returned an invalid ref.');
  }
  return match[1].toLowerCase();
}

function workspaceObjectDirectory(repositoryRoot: string): string {
  const gitDirectory = path.join(repositoryRoot, '.git');
  const objectDirectory = path.join(gitDirectory, 'objects');
  for (const directory of [gitDirectory, objectDirectory]) {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(directory);
    } catch {
      throw new Error(
        'Bot PR requires a normal repository with a local Git object directory.',
      );
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(
        'Bot PR refuses a linked or non-directory Git object store.',
      );
    }
  }
  const realGitDirectory = fs.realpathSync(gitDirectory);
  const realObjectDirectory = fs.realpathSync(objectDirectory);
  if (
    realGitDirectory !== gitDirectory ||
    realObjectDirectory !== objectDirectory ||
    realObjectDirectory.includes(path.delimiter)
  ) {
    throw new Error('Bot PR could not resolve an isolated Git object store.');
  }
  return realObjectDirectory;
}

async function createIsolatedPushContext(
  workspaceContext: DeliveryContext,
  botIdentity: AgentIdentity,
  developerHeadSha: string,
  commitSha: string,
  files: ValidatedChangedFile[],
): Promise<{
  cleanup: () => void;
  context: DeliveryContext;
  directory: string;
}> {
  const objectDirectory = workspaceObjectDirectory(workspaceContext.cwd);
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'playrunner-bot-delivery-'),
  );
  const repositoryDirectory = path.join(directory, 'repository.git');
  try {
    if (
      directory === workspaceContext.cwd ||
      directory.startsWith(`${workspaceContext.cwd}${path.sep}`)
    ) {
      throw new Error(
        'Bot PR credential storage must be outside the untrusted workspace.',
      );
    }
    fs.chownSync(directory, botIdentity.uid, botIdentity.gid);
    fs.chmodSync(directory, 0o700);
    fs.mkdirSync(repositoryDirectory, { mode: 0o700 });
    fs.chownSync(repositoryDirectory, botIdentity.uid, botIdentity.gid);
    fs.chmodSync(repositoryDirectory, 0o700);
    const context: DeliveryContext = {
      baseEnvironment: {
        ...botGitEnvironment(botIdentity),
        GIT_ALTERNATE_OBJECT_DIRECTORIES: objectDirectory,
      },
      cwd: repositoryDirectory,
      identity: botIdentity,
      runCommand: workspaceContext.runCommand,
    };
    await runGit(
      context,
      ['init', '--bare', '.'],
      'creating isolated bot Git repository',
    );
    await runGit(
      context,
      ['cat-file', '-e', `${commitSha}^{commit}`],
      'loading the verified bot commit into the isolated repository',
      { maxOutputBytes: 4096 },
    );
    const parentSha = (
      await runGit(
        context,
        ['rev-parse', `${commitSha}^`],
        'checking the isolated bot commit parent',
        { maxOutputBytes: 4096 },
      )
    )
      .trim()
      .toLowerCase();
    if (parentSha !== developerHeadSha) {
      throw new Error(
        'Bot PR isolated commit is not based on the requested developer SHA.',
      );
    }
    await assertCommitMatchesValidatedFiles(
      context,
      developerHeadSha,
      commitSha,
      files,
    );
    return {
      cleanup: () => fs.rmSync(directory, { force: true, recursive: true }),
      context,
      directory,
    };
  } catch (error) {
    fs.rmSync(directory, { force: true, recursive: true });
    throw error;
  }
}

function credentialConfigEnvironment(
  context: DeliveryContext,
  directory: string,
  githubToken: string,
  agentIdentity: AgentIdentity,
): { cleanup: () => void; environment: NodeJS.ProcessEnv } {
  const credentialPath = path.join(directory, 'github-credentials.config');
  const authorization = Buffer.from(
    `x-access-token:${githubToken}`,
    'utf8',
  ).toString('base64');
  fs.writeFileSync(
    credentialPath,
    `[http "https://github.com/"]\n\textraHeader = Authorization: Basic ${authorization}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  fs.chownSync(credentialPath, context.identity.uid, context.identity.gid);
  fs.chmodSync(credentialPath, 0o600);
  const stat = fs.statSync(credentialPath);
  if (
    stat.uid !== context.identity.uid ||
    (stat.mode & 0o077) !== 0 ||
    context.identity.uid === agentIdentity.uid
  ) {
    fs.rmSync(credentialPath, { force: true });
    throw new Error(
      'Bot PR could not isolate its temporary GitHub credential file from the untrusted agent UID.',
    );
  }
  return {
    cleanup: () => fs.rmSync(credentialPath, { force: true }),
    environment: {
      ...context.baseEnvironment,
      GIT_CONFIG_GLOBAL: credentialPath,
    },
  };
}

async function pushBranch(
  context: DeliveryContext,
  botIdentity: AgentIdentity,
  fetcher: BotPrFetcher,
  sourceRepository: string,
  forkRepository: string,
  branchName: string,
  commitSha: string,
  developerHeadRef: string,
  developerHeadSha: string,
  githubToken: string,
  files: ValidatedChangedFile[],
): Promise<void> {
  const forkRemoteUrl = `https://github.com/${forkRepository}.git`;
  await assertRemoteDeveloperBranchUnchanged(
    context,
    sourceRepository,
    developerHeadRef,
    developerHeadSha,
  );
  const existingSha = parseRemoteBranchSha(
    await runGit(
      context,
      [
        '-c',
        'http.followRedirects=false',
        '-c',
        'http.sslVerify=true',
        'ls-remote',
        '--heads',
        forkRemoteUrl,
        `refs/heads/${branchName}`,
      ],
      'checking the remote bot branch',
      { maxOutputBytes: 4096 },
    ),
    branchName,
  );
  const isolated = await createIsolatedPushContext(
    context,
    botIdentity,
    developerHeadSha,
    commitSha,
    files,
  );
  try {
    await ensureForkActionsDisabled(fetcher, githubToken, forkRepository);
    const credentials = credentialConfigEnvironment(
      isolated.context,
      isolated.directory,
      githubToken,
      context.identity,
    );
    try {
      await runGit(
        isolated.context,
        [
          '-c',
          'http.followRedirects=false',
          '-c',
          'http.sslVerify=true',
          '-c',
          'credential.helper=',
          '-c',
          'core.askPass=',
          'push',
          '--porcelain',
          `--force-with-lease=refs/heads/${branchName}:${existingSha}`,
          forkRemoteUrl,
          `${commitSha}:refs/heads/${branchName}`,
        ],
        'pushing the bot branch',
        { authenticatedEnvironment: credentials.environment },
      );
    } finally {
      credentials.cleanup();
    }
  } finally {
    isolated.cleanup();
  }
}

async function assertRemoteDeveloperBranchUnchanged(
  context: DeliveryContext,
  sourceRepository: string,
  developerHeadRef: string,
  developerHeadSha: string,
): Promise<void> {
  const sourceRemoteUrl = `https://github.com/${sourceRepository}.git`;
  const remoteDeveloperSha = parseRemoteBranchSha(
    await runGit(
      context,
      [
        '-c',
        'http.followRedirects=false',
        '-c',
        'http.sslVerify=true',
        'ls-remote',
        '--heads',
        sourceRemoteUrl,
        `refs/heads/${developerHeadRef}`,
      ],
      'checking the remote developer branch',
      { maxOutputBytes: 4096 },
    ),
    developerHeadRef,
  );
  if (remoteDeveloperSha !== developerHeadSha) {
    throw new Error(
      'Bot PR developer branch moved after this execution was created.',
    );
  }
}

async function readBoundedResponse(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') || '0');
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_GITHUB_RESPONSE_BYTES
  ) {
    throw new Error('GitHub API response exceeded the size limit.');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    const chunk = Buffer.from(item.value);
    bytes += chunk.length;
    if (bytes > MAX_GITHUB_RESPONSE_BYTES) {
      void reader.cancel().catch(() => undefined);
      throw new Error('GitHub API response exceeded the size limit.');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function githubRequest(
  fetcher: BotPrFetcher,
  githubToken: string,
  pathname: string,
  init: { body?: string; method: 'GET' | 'POST' | 'PUT' },
): Promise<GitHubResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  let response: Response;
  let text: string;
  try {
    response = await fetcher(`${GITHUB_API_ORIGIN}${pathname}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${githubToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'playrunner-test-bot',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
      },
      redirect: 'error',
      signal: controller.signal,
    });
    text = await readBoundedResponse(response);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'GitHub API response exceeded the size limit.'
    ) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw new Error('GitHub API request timed out.');
    }
    throw new Error('GitHub API request failed.');
  } finally {
    clearTimeout(timeout);
  }
  let body: unknown = null;
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error('GitHub API returned invalid JSON.');
    }
  }
  return { body, status: response.status };
}

function forkActionsSetupError(forkRepository: string, detail: string): Error {
  return new Error(
    `Bot PR requires GitHub Actions to be disabled on the dedicated public fork ${forkRepository}. ${detail} Disable Actions manually under Settings > Actions > General, or grant the GitHub App Administration: read and write so Playrunner can disable and verify it before every push.`,
  );
}

async function readForkActionsEnabled(
  fetcher: BotPrFetcher,
  githubToken: string,
  forkRepository: string,
): Promise<boolean> {
  const response = await githubRequest(
    fetcher,
    githubToken,
    `/repos/${forkRepository}/actions/permissions`,
    { method: 'GET' },
  );
  if (response.status !== 200) {
    throw forkActionsSetupError(
      forkRepository,
      `GitHub could not inspect the fork Actions permission (${response.status}).`,
    );
  }
  const permissions = githubRecord(response.body);
  if (!permissions || typeof permissions.enabled !== 'boolean') {
    throw forkActionsSetupError(
      forkRepository,
      'GitHub returned an invalid Actions permission response.',
    );
  }
  return permissions.enabled;
}

async function ensureForkActionsDisabled(
  fetcher: BotPrFetcher,
  githubToken: string,
  forkRepository: string,
): Promise<void> {
  if (!(await readForkActionsEnabled(fetcher, githubToken, forkRepository))) {
    return;
  }
  const disabled = await githubRequest(
    fetcher,
    githubToken,
    `/repos/${forkRepository}/actions/permissions`,
    { body: JSON.stringify({ enabled: false }), method: 'PUT' },
  );
  if (disabled.status !== 204) {
    throw forkActionsSetupError(
      forkRepository,
      `GitHub could not disable Actions on the fork (${disabled.status}).`,
    );
  }
  if (await readForkActionsEnabled(fetcher, githubToken, forkRepository)) {
    throw forkActionsSetupError(
      forkRepository,
      'GitHub still reports Actions enabled after the disable request.',
    );
  }
}

function githubRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function repositoryMetadata(
  value: unknown,
  expectedRepository: string,
  label: 'fork' | 'source',
): {
  defaultBranch?: string;
  fullName: string;
  owner: string;
  record: Record<string, unknown>;
} {
  const metadata = githubRecord(value);
  if (!metadata || typeof metadata.full_name !== 'string') {
    throw new Error(`GitHub returned invalid ${label} repository metadata.`);
  }
  let normalized: ReturnType<typeof normalizeRepository>;
  try {
    normalized = normalizeRepository(metadata.full_name);
  } catch {
    throw new Error(`GitHub returned invalid ${label} repository metadata.`);
  }
  if (
    normalized.repository.toLowerCase() !== expectedRepository.toLowerCase()
  ) {
    throw new Error(
      `GitHub ${label} repository metadata did not match ${expectedRepository}.`,
    );
  }
  const owner = githubRecord(metadata.owner);
  if (
    !owner ||
    typeof owner.login !== 'string' ||
    owner.login.toLowerCase() !== normalized.owner.toLowerCase()
  ) {
    throw new Error(`GitHub returned invalid ${label} repository ownership.`);
  }
  const verifiedOwner = normalizeRepository(
    `${owner.login}/${normalized.name}`,
  ).owner;
  return {
    ...(typeof metadata.default_branch === 'string'
      ? { defaultBranch: metadata.default_branch }
      : {}),
    fullName: normalized.repository,
    owner: verifiedOwner,
    record: metadata,
  };
}

function assertPublicRepository(
  metadata: Record<string, unknown>,
  label: 'fork' | 'source',
): void {
  if (metadata.private !== false || metadata.visibility !== 'public') {
    throw new Error(
      `Bot PR ${label} repository must be public. Private and internal repositories are not supported by the generated-test fork workflow.`,
    );
  }
}

async function verifyPublicRepositories(
  fetcher: BotPrFetcher,
  githubToken: string,
  sourceRepository: string,
  configuredForkRepository: string,
): Promise<VerifiedPublicRepositories> {
  if (
    sourceRepository.toLowerCase() === configuredForkRepository.toLowerCase()
  ) {
    throw new Error(
      'Bot PR requires a distinct public fork; the fork cannot be the source repository.',
    );
  }
  const sourceResponse = await githubRequest(
    fetcher,
    githubToken,
    `/repos/${sourceRepository}`,
    { method: 'GET' },
  );
  if (sourceResponse.status !== 200) {
    throw new Error(
      `GitHub could not verify the source repository (${sourceResponse.status}). Ensure the GitHub App is installed on the public source repository.`,
    );
  }
  const source = repositoryMetadata(
    sourceResponse.body,
    sourceRepository,
    'source',
  );
  assertPublicRepository(source.record, 'source');
  const sourceDefaultBranch = normalizeHeadRef(source.defaultBranch || '');

  const forkResponse = await githubRequest(
    fetcher,
    githubToken,
    `/repos/${configuredForkRepository}`,
    { method: 'GET' },
  );
  if (forkResponse.status !== 200) {
    throw new Error(
      `GitHub could not verify the bot PR fork (${forkResponse.status}). Install the GitHub App on the distinct public fork with Contents: read and write.`,
    );
  }
  const fork = repositoryMetadata(
    forkResponse.body,
    configuredForkRepository,
    'fork',
  );
  assertPublicRepository(fork.record, 'fork');
  const parent = githubRecord(fork.record.parent);
  if (
    fork.record.fork !== true ||
    !parent ||
    typeof parent.full_name !== 'string' ||
    parent.full_name.toLowerCase() !== source.fullName.toLowerCase()
  ) {
    throw new Error(
      `Bot PR fork ${fork.fullName} must be a direct GitHub fork of ${source.fullName}.`,
    );
  }
  const permissions = githubRecord(fork.record.permissions);
  if (!permissions || permissions.push !== true) {
    throw new Error(
      `The GitHub connection cannot push to ${fork.fullName}. Install the GitHub App on the public fork with Contents: read and write.`,
    );
  }
  return {
    forkOwner: fork.owner,
    forkRepository: fork.fullName,
    sourceDefaultBranch,
    sourceRepository: source.fullName,
  };
}

function decodeGitHubBlob(
  value: unknown,
  expectedSha: string,
  workflowPath: string,
): Buffer {
  const blob = githubRecord(value);
  const size = blob ? Number(blob.size) : Number.NaN;
  if (
    !blob ||
    blob.encoding !== 'base64' ||
    typeof blob.content !== 'string' ||
    !Number.isSafeInteger(size) ||
    size < 0 ||
    size > MAX_SOURCE_WORKFLOW_FILE_BYTES ||
    typeof blob.sha !== 'string' ||
    blob.sha.toLowerCase() !== expectedSha.toLowerCase()
  ) {
    throw new Error(
      `GitHub returned invalid or oversized source workflow content for ${workflowPath}.`,
    );
  }
  const encoded = blob.content.replace(/\r?\n/g, '');
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encoded,
    )
  ) {
    throw new Error(
      `GitHub returned invalid source workflow encoding for ${workflowPath}.`,
    );
  }
  const contents = Buffer.from(encoded, 'base64');
  if (contents.length !== size) {
    throw new Error(
      `GitHub returned inconsistent source workflow content for ${workflowPath}.`,
    );
  }
  return contents;
}

const STANDARD_GITHUB_HOSTED_RUNNERS = new Set([
  'macos-13',
  'macos-13-large',
  'macos-13-xlarge',
  'macos-14',
  'macos-14-large',
  'macos-14-xlarge',
  'macos-15',
  'macos-15-large',
  'macos-15-xlarge',
  'macos-26',
  'macos-latest',
  'ubuntu-22.04',
  'ubuntu-22.04-arm',
  'ubuntu-24.04',
  'ubuntu-24.04-arm',
  'ubuntu-latest',
  'windows-11-arm',
  'windows-2022',
  'windows-2025',
  'windows-latest',
]);

function stripYamlComment(line: string): string {
  let quote: "'" | '"' | '' = '';
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote === '"') {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        quote = '';
      }
      continue;
    }
    if (quote === "'") {
      if (character === "'" && line[index + 1] === "'") {
        index += 1;
      } else if (character === "'") {
        quote = '';
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '#' && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index);
    }
  }
  return line;
}

function staticRunnerLabel(value: string): string | null {
  const normalized = value.trim();
  if (/^[A-Za-z0-9.-]+$/.test(normalized)) return normalized.toLowerCase();
  const singleQuoted = /^'([A-Za-z0-9.-]+)'$/.exec(normalized);
  if (singleQuoted) return singleQuoted[1].toLowerCase();
  const doubleQuoted = /^"([A-Za-z0-9.-]+)"$/.exec(normalized);
  return doubleQuoted ? doubleQuoted[1].toLowerCase() : null;
}

function maskQuotedYaml(value: string): string {
  let quote: "'" | '"' | '' = '';
  let escaped = false;
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === '"') {
      result += ' ';
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quote = '';
      continue;
    }
    if (quote === "'") {
      result += ' ';
      if (character === "'" && value[index + 1] === "'") {
        result += ' ';
        index += 1;
      } else if (character === "'") {
        quote = '';
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      result += ' ';
    } else {
      result += character;
    }
  }
  return result;
}

function unsafeRunnerError(workflowPath: string): Error {
  return new Error(
    `Bot PR source workflow ${workflowPath} must use only statically declared standard GitHub-hosted runs-on labels. Self-hosted/custom runners, runner groups, expressions, matrices, anchors, and reusable-workflow job indirection are not supported by the public-fork v1 safety boundary.`,
  );
}

function assertSafeWorkflowContents(
  contents: Buffer,
  workflowPath: string,
): void {
  const text = contents.toString('utf8');
  if (text.includes('\uFFFD') || text.includes('\0')) {
    throw new Error(
      `Bot PR source workflow ${workflowPath} is not valid bounded UTF-8 text.`,
    );
  }
  if (
    /(^|[^A-Za-z0-9_])(pull_request_target|workflow_run)([^A-Za-z0-9_]|$)/m.test(
      text,
    )
  ) {
    throw new Error(
      'Bot PR delivery is disabled because source workflows reference pull_request_target or workflow_run. Use pull_request with read-only permissions for generated-test PRs.',
    );
  }
  let blockScalarIndent: number | null = null;
  let currentJobHasRunner = false;
  let currentJobName = '';
  let jobIndent: number | null = null;
  let jobPropertyIndent: number | null = null;
  let jobsIndent: number | null = null;
  let sawJob = false;
  let sawJobs = false;
  const finishJob = () => {
    if (currentJobName && !currentJobHasRunner) {
      throw unsafeRunnerError(workflowPath);
    }
    currentJobHasRunner = false;
    currentJobName = '';
    jobPropertyIndent = null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    if (/^ *\t/.test(rawLine)) throw unsafeRunnerError(workflowPath);
    const indent = /^ */.exec(rawLine)?.[0].length || 0;
    if (blockScalarIndent !== null) {
      if (!rawLine.trim() || indent > blockScalarIndent) continue;
      blockScalarIndent = null;
    }
    const line = stripYamlComment(rawLine);
    if (!line.trim()) continue;
    if (/\\(?:x[0-9a-f]{2}|u[0-9a-f]{4}|U[0-9a-f]{8})/i.test(line)) {
      throw unsafeRunnerError(workflowPath);
    }
    const structural = maskQuotedYaml(line);
    if (
      /(^|[\s[{,:-])[&*][A-Za-z0-9_-]+(?=$|[\s}\],:])/.test(structural) ||
      /^\s*<<\s*:/.test(structural)
    ) {
      throw unsafeRunnerError(workflowPath);
    }
    if (/(^|[^A-Za-z0-9_-])self-hosted([^A-Za-z0-9_-]|$)/i.test(line)) {
      throw unsafeRunnerError(workflowPath);
    }

    const jobs = /^\s*(?:jobs|'jobs'|"jobs")\s*:\s*(.*?)\s*$/.exec(line);
    if (jobs) {
      if (sawJobs || jobs[1]) throw unsafeRunnerError(workflowPath);
      sawJobs = true;
      jobsIndent = indent;
      continue;
    }
    if (jobsIndent !== null && jobIndent !== null && indent <= jobsIndent) {
      finishJob();
      jobsIndent = null;
      jobIndent = null;
    }

    const mapping =
      /^\s*(?:[A-Za-z0-9_-]+|'[^']+'|"[^"]+")\s*:\s*(.*?)\s*$/.exec(line);
    if (jobsIndent !== null && indent > jobsIndent) {
      if (jobIndent === null) {
        if (!mapping || mapping[1]) throw unsafeRunnerError(workflowPath);
        jobIndent = indent;
      }
      if (indent === jobIndent) {
        finishJob();
        if (!mapping || mapping[1]) throw unsafeRunnerError(workflowPath);
        currentJobName = line.trim().slice(0, -1);
        sawJob = true;
        continue;
      }
      if (!currentJobName || indent < jobIndent) {
        throw unsafeRunnerError(workflowPath);
      }
      if (mapping && jobPropertyIndent === null) {
        jobPropertyIndent = indent;
      }
    }

    if (
      currentJobName &&
      jobPropertyIndent !== null &&
      indent === jobPropertyIndent &&
      /^\s*(?:uses|'uses'|"uses")\s*:/.test(line)
    ) {
      throw unsafeRunnerError(workflowPath);
    }
    const runsOn = /^\s*(?:runs-on|'runs-on'|"runs-on")\s*:\s*(.*?)\s*$/.exec(
      line,
    );
    if (runsOn) {
      const label = staticRunnerLabel(runsOn[1]);
      if (
        !currentJobName ||
        indent !== jobPropertyIndent ||
        !label ||
        !STANDARD_GITHUB_HOSTED_RUNNERS.has(label)
      ) {
        throw unsafeRunnerError(workflowPath);
      }
      currentJobHasRunner = true;
      continue;
    }
    if (
      /[{,]\s*["']?runs-on["']?\s*:/i.test(line) ||
      /^\s*(?:runs-on|'runs-on'|"runs-on")\b/i.test(line)
    ) {
      throw unsafeRunnerError(workflowPath);
    }
    if (/^\s*[^#]+:\s*[|>][+-]?\d?\s*$/.test(line)) {
      blockScalarIndent = indent;
    }
  }
  finishJob();
  if (sawJobs && !sawJob) throw unsafeRunnerError(workflowPath);
}

async function resolveSourceBranchSha(
  fetcher: BotPrFetcher,
  githubToken: string,
  sourceRepository: string,
  branchName: string,
): Promise<string> {
  const commit = await githubRequest(
    fetcher,
    githubToken,
    `/repos/${sourceRepository}/commits/${encodeURIComponent(branchName)}`,
    { method: 'GET' },
  );
  const commitRecord = githubRecord(commit.body);
  let branchSha = '';
  if (commitRecord && typeof commitRecord.sha === 'string') {
    try {
      branchSha = normalizeHeadSha(commitRecord.sha);
    } catch {
      branchSha = '';
    }
  }
  if (commit.status !== 200 || !branchSha) {
    throw new Error(
      `GitHub could not resolve the immutable source branch commit for ${sourceRepository}.`,
    );
  }
  return branchSha;
}

async function assertSafeDefaultBranchWorkflows(
  fetcher: BotPrFetcher,
  githubToken: string,
  sourceRepository: string,
  sourceDefaultBranch: string,
): Promise<string> {
  const defaultBranchSha = await resolveSourceBranchSha(
    fetcher,
    githubToken,
    sourceRepository,
    sourceDefaultBranch,
  );
  const parameters = new URLSearchParams({ ref: defaultBranchSha });
  const listing = await githubRequest(
    fetcher,
    githubToken,
    `/repos/${sourceRepository}/contents/.github/workflows?${parameters.toString()}`,
    { method: 'GET' },
  );
  if (listing.status === 404) return defaultBranchSha;
  if (listing.status !== 200 || !Array.isArray(listing.body)) {
    throw new Error(
      `GitHub could not inspect default-branch workflows for ${sourceRepository} (${listing.status}).`,
    );
  }
  if (listing.body.length > MAX_SOURCE_WORKFLOW_FILES) {
    throw new Error(
      `Bot PR source has too many workflow entries to inspect safely (maximum ${MAX_SOURCE_WORKFLOW_FILES}).`,
    );
  }
  const workflows: Array<{ path: string; sha: string }> = [];
  for (const value of listing.body) {
    const entry = githubRecord(value);
    if (!entry || typeof entry.path !== 'string') {
      throw new Error('GitHub returned invalid source workflow metadata.');
    }
    const workflowPath = validateRelativePath(entry.path);
    if (!/^\.github\/workflows\/[^/]+\.ya?ml$/i.test(workflowPath)) {
      continue;
    }
    if (
      entry.type !== 'file' ||
      typeof entry.sha !== 'string' ||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(entry.sha)
    ) {
      throw new Error(
        `GitHub returned invalid source workflow metadata for ${workflowPath}.`,
      );
    }
    workflows.push({ path: workflowPath, sha: entry.sha.toLowerCase() });
  }

  let totalBytes = 0;
  for (const workflow of workflows) {
    const blob = await githubRequest(
      fetcher,
      githubToken,
      `/repos/${sourceRepository}/git/blobs/${workflow.sha}`,
      { method: 'GET' },
    );
    if (blob.status !== 200) {
      throw new Error(
        `GitHub could not inspect source workflow ${workflow.path} (${blob.status}).`,
      );
    }
    const contents = decodeGitHubBlob(blob.body, workflow.sha, workflow.path);
    totalBytes += contents.length;
    if (totalBytes > MAX_SOURCE_WORKFLOW_BYTES) {
      throw new Error(
        `Bot PR source workflows exceed the ${MAX_SOURCE_WORKFLOW_BYTES}-byte inspection limit.`,
      );
    }
    assertSafeWorkflowContents(contents, workflow.path);
  }
  return defaultBranchSha;
}

async function assertDefaultBranchInspectionStillCurrent(
  fetcher: BotPrFetcher,
  githubToken: string,
  sourceRepository: string,
  expectedDefaultBranch: string,
  expectedDefaultBranchSha: string,
): Promise<void> {
  const sourceResponse = await githubRequest(
    fetcher,
    githubToken,
    `/repos/${sourceRepository}`,
    { method: 'GET' },
  );
  if (sourceResponse.status !== 200) {
    throw new Error(
      `GitHub could not reverify the source repository before creating the bot PR (${sourceResponse.status}).`,
    );
  }
  const source = repositoryMetadata(
    sourceResponse.body,
    sourceRepository,
    'source',
  );
  assertPublicRepository(source.record, 'source');
  const currentDefaultBranch = normalizeHeadRef(source.defaultBranch || '');
  if (currentDefaultBranch !== expectedDefaultBranch) {
    throw new Error(
      'Bot PR source default branch changed after its workflow safety inspection.',
    );
  }
  const currentDefaultBranchSha = await resolveSourceBranchSha(
    fetcher,
    githubToken,
    sourceRepository,
    currentDefaultBranch,
  );
  if (currentDefaultBranchSha !== expectedDefaultBranchSha) {
    throw new Error(
      'Bot PR source default branch moved after its workflow safety inspection.',
    );
  }
}

function pullRequestNumber(value: unknown): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const number = Number((value as Record<string, unknown>).number);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function metadataFor(
  repository: string,
  number: number,
  title: string,
  branchName: string,
  baseRef: string,
): BotPullRequestMetadata {
  return {
    baseRef,
    draft: true,
    headRef: branchName,
    number,
    title,
    url: `https://github.com/${repository}/pull/${number}`,
  };
}

async function createPullRequest(
  fetcher: BotPrFetcher,
  githubToken: string,
  repository: string,
  forkOwner: string,
  forkRepository: string,
  branchName: string,
  developerHeadRef: string,
  developerHeadSha: string,
  executionId: string,
  nodeId: string,
): Promise<{
  metadata: BotPullRequestMetadata;
  status: 'created' | 'existing';
}> {
  const qualifiedHead = `${forkOwner}:${branchName}`;
  const title = `test: generate coverage for ${developerHeadSha}`;
  const body = [
    'Automated tests generated and validated by Playrunner.',
    '',
    '> [!WARNING]',
    '> This is a draft. Coverage was reported by repository-controlled test code and is not a trusted attestation. A human must review the generated tests, and source-repository CI must pass, before this PR is marked ready or merged.',
    '',
    `- Developer head: \`${developerHeadSha}\``,
    `- Base ref: \`${developerHeadRef}\``,
    `- Execution: \`${executionId}\``,
    `- AI Container node: \`${nodeId}\``,
  ].join('\n');
  const create = await githubRequest(
    fetcher,
    githubToken,
    `/repos/${repository}/pulls`,
    {
      body: JSON.stringify({
        base: developerHeadRef,
        body,
        draft: true,
        head: qualifiedHead,
        head_repo: forkRepository,
        maintainer_can_modify: true,
        title,
      }),
      method: 'POST',
    },
  );
  if (create.status === 200 || create.status === 201) {
    const number = pullRequestNumber(create.body);
    if (
      !number ||
      !githubRecord(create.body) ||
      githubRecord(create.body)?.draft !== true
    ) {
      throw new Error(
        'GitHub did not confirm that the generated-test pull request is a draft.',
      );
    }
    return {
      metadata: metadataFor(
        repository,
        number,
        title,
        branchName,
        developerHeadRef,
      ),
      status: create.status === 201 ? 'created' : 'existing',
    };
  }
  if (create.status !== 409 && create.status !== 422) {
    throw new Error(`GitHub API could not create the PR (${create.status}).`);
  }

  const parameters = new URLSearchParams({
    base: developerHeadRef,
    head: qualifiedHead,
    per_page: '10',
    state: 'open',
  });
  const existing = await githubRequest(
    fetcher,
    githubToken,
    `/repos/${repository}/pulls?${parameters.toString()}`,
    { method: 'GET' },
  );
  if (existing.status !== 200 || !Array.isArray(existing.body)) {
    throw new Error('GitHub API could not resolve the existing bot PR.');
  }
  const matchingCandidate = existing.body.find((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return false;
    const record = value as Record<string, unknown>;
    const head = githubRecord(record.head);
    const base = githubRecord(record.base);
    const headRepository = head ? githubRecord(head.repo) : null;
    const headRepositoryOwner = headRepository
      ? githubRecord(headRepository.owner)
      : null;
    return (
      pullRequestNumber(record) !== null &&
      head?.ref === branchName &&
      base?.ref === developerHeadRef &&
      typeof headRepository?.full_name === 'string' &&
      headRepository.full_name.toLowerCase() === forkRepository.toLowerCase() &&
      typeof headRepositoryOwner?.login === 'string' &&
      headRepositoryOwner.login.toLowerCase() === forkOwner.toLowerCase()
    );
  });
  const candidate = githubRecord(matchingCandidate);
  if (candidate && candidate.draft !== true) {
    throw new Error(
      'The existing generated-test pull request is not a draft. Convert it to draft or close it before retrying bot delivery.',
    );
  }
  const number = pullRequestNumber(candidate);
  if (!number)
    throw new Error('GitHub API did not return the existing bot PR.');
  return {
    metadata: metadataFor(
      repository,
      number,
      title,
      branchName,
      developerHeadRef,
    ),
    status: 'existing',
  };
}

export async function deliverBotPullRequest(
  options: BotPrDeliveryOptions,
): Promise<BotPrDeliveryResult> {
  const { repository } = normalizeRepository(options.repository);
  const { repository: configuredForkRepository } = normalizeRepository(
    options.forkRepository,
  );
  const developerHeadSha = normalizeHeadSha(options.developerHeadSha);
  const developerHeadRef = normalizeHeadRef(options.developerHeadRef);
  const executionId = requiredIdentifier(options.executionId, 'executionId');
  const nodeId = requiredIdentifier(options.nodeId, 'nodeId');
  const workflowId = requiredIdentifier(options.workflowId, 'workflowId');
  const githubToken = normalizeToken(options.githubToken);
  const prohibitedExactValues = normalizeProhibitedExactValues([
    githubToken,
    ...(options.prohibitedExactValues || []),
  ]);
  const identity = options.identity || getAgentIdentity(options.environment);
  const botIdentity = options.botIdentity || currentBotIdentity();
  assertIsolatedBotIdentity(botIdentity, identity);
  const baseEnvironment = createGitEnvironment(undefined, identity, {
    ...cleanGitEnvironment(options.environment || process.env),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_SYSTEM: '/dev/null',
  });
  const initialContext: DeliveryContext = {
    baseEnvironment,
    cwd: options.cwd,
    identity,
    runCommand: options.runCommand || runProcess,
  };
  const root = await resolveRepositoryRoot(initialContext);
  const context = { ...initialContext, cwd: root };
  await assertSafeRepositoryGitConfig(context);
  const currentHead = (
    await runGit(context, ['rev-parse', 'HEAD'], 'checking developer head', {
      maxOutputBytes: 4096,
    })
  )
    .trim()
    .toLowerCase();
  if (currentHead !== developerHeadSha) {
    throw new Error('Bot PR workspace is not at the requested developer SHA.');
  }
  const status = parseStatus(
    await runGit(
      context,
      [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
        '--no-renames',
      ],
      'reading generated changes',
    ),
  );
  if (!status.length) {
    return {
      changedFiles: [],
      developerHeadSha,
      generatedTestFiles: [],
      status: 'no_changes',
    };
  }
  const validatedFiles = await validateChangedFiles(
    context,
    root,
    developerHeadSha,
    status,
    prohibitedExactValues,
  );
  const fetcher = options.fetcher || fetch;
  const verified = await verifyPublicRepositories(
    fetcher,
    githubToken,
    repository,
    configuredForkRepository,
  );
  await assertNoPrivilegedWorkflowAtDeveloperHead(context, developerHeadSha);
  const inspectedDefaultBranchSha = await assertSafeDefaultBranchWorkflows(
    fetcher,
    githubToken,
    verified.sourceRepository,
    verified.sourceDefaultBranch,
  );
  const branchName = buildBranchName(
    verified.sourceRepository,
    workflowId,
    developerHeadSha,
    nodeId,
  );
  if (branchName.toLowerCase() === developerHeadRef.toLowerCase()) {
    throw new Error('Bot PR branch must differ from the developer branch.');
  }
  const commitSha = await stageAndCommit(
    context,
    validatedFiles,
    branchName,
    developerHeadSha,
  );
  await pushBranch(
    context,
    botIdentity,
    fetcher,
    verified.sourceRepository,
    verified.forkRepository,
    branchName,
    commitSha,
    developerHeadRef,
    developerHeadSha,
    githubToken,
    validatedFiles,
  );
  await assertDefaultBranchInspectionStillCurrent(
    fetcher,
    githubToken,
    verified.sourceRepository,
    verified.sourceDefaultBranch,
    inspectedDefaultBranchSha,
  );
  await assertRemoteDeveloperBranchUnchanged(
    context,
    verified.sourceRepository,
    developerHeadRef,
    developerHeadSha,
  );
  const pullRequest = await createPullRequest(
    fetcher,
    githubToken,
    verified.sourceRepository,
    verified.forkOwner,
    verified.forkRepository,
    branchName,
    developerHeadRef,
    developerHeadSha,
    executionId,
    nodeId,
  );
  return {
    branchName,
    changedFiles: validatedFiles.map((file) => file.path),
    commitSha,
    developerHeadSha,
    generatedTestFiles: validatedFiles
      .map((file) => file.path)
      .filter(isGeneratedTestFile),
    pullRequest: pullRequest.metadata,
    status: pullRequest.status,
  };
}
