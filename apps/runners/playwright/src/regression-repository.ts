import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildRegressionPlan,
  normalizeRegressionPath,
  normalizeRegressionRepository,
  normalizeRegressionRevision,
  parseRegressionPolicy,
  parseRegressionRequest,
  REGRESSION_LIMITS,
  RegressionValidationError,
  type RegressionChange,
  type RegressionPlan,
  type RegressionSnapshot,
} from '../../shared/regression';
import { createGitCredentialEnvironment } from './repository';

export type RegressionGitRunner = (
  args: string[],
  options: {
    cwd?: string;
    environment: NodeJS.ProcessEnv;
    maxOutputBytes: number;
    timeoutMs: number;
  },
) => Promise<Buffer>;

/** Never include Git's output/argv in errors: either can contain provider secrets. */
export const runRegressionGit: RegressionGitRunner = (args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: options.cwd,
      env: options.environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let failed = false;
    let settled = false;
    const stop = () => {
      failed = true;
      try {
        if (process.platform !== 'win32' && child.pid)
          process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        /* Process may already have exited. */
      }
    };
    const timer = setTimeout(stop, options.timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > options.maxOutputBytes) stop();
      else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > options.maxOutputBytes) stop();
    });
    const complete = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(Buffer.concat(chunks));
    };
    child.on('error', () =>
      complete(new Error('Git snapshot command could not start.')),
    );
    child.on('close', (code) =>
      complete(
        failed || code !== 0
          ? new Error(
              'Git snapshot command failed or exceeded its time/output limit.',
            )
          : undefined,
      ),
    );
  });

export function regressionGitEnvironment(token?: string): NodeJS.ProcessEnv {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith('GIT_') && name !== 'SSH_ASKPASS',
    ),
  );
  return createGitCredentialEnvironment(token, {
    ...clean,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_PAGER: 'cat',
  });
}

function parseDiff(repository: string, output: Buffer): RegressionChange[] {
  const parts = output.toString('utf8').split('\0');
  if (parts.pop() !== '')
    throw new Error('Git changed-file output is truncated.');
  const changes: RegressionChange[] = [];
  for (let index = 0; index < parts.length; ) {
    const rawStatus = parts[index++];
    const firstPath = normalizeRegressionPath(parts[index++]);
    const codes: Record<string, RegressionChange['status']> = {
      A: 'added',
      M: 'modified',
      D: 'deleted',
      R: 'renamed',
      C: 'copied',
      T: 'type_changed',
    };
    const status = codes[rawStatus[0]];
    if (!status || !/^(?:[AMDT]|[RC]\d{1,3})$/.test(rawStatus))
      throw new Error('Git change contains an unsupported status.');
    const renamed = status === 'renamed' || status === 'copied';
    changes.push({
      repository,
      path: renamed ? normalizeRegressionPath(parts[index++]) : firstPath,
      status,
      ...(renamed ? { previousPath: firstPath } : {}),
    });
    if (changes.length > REGRESSION_LIMITS.changes)
      throw new Error('Git changed-file count exceeds the supported limit.');
  }
  return changes;
}

type TreeEntry = { mode: string; objectId: string; path: string; size: number };

function treeEntries(output: Buffer): TreeEntry[] {
  const parts = output.toString('utf8').split('\0');
  if (parts.pop() !== '') throw new Error('Git tree output is truncated.');
  if (parts.length > REGRESSION_LIMITS.files)
    throw new Error('Git tree contains too many files.');
  return parts.map((entry) => {
    const matched =
      /^(\d{6}) (blob|commit) ([a-f0-9]{40})\s+(\d+|-)\t(.+)$/s.exec(entry);
    if (!matched) throw new Error('Git tree contains an unsupported entry.');
    return {
      mode: matched[1],
      objectId: matched[3],
      size: matched[4] === '-' ? 0 : Number(matched[4]),
      path: normalizeRegressionPath(matched[5]),
    };
  });
}

export async function prepareRegressionPlan(options: {
  request: unknown;
  policy?: unknown;
  workspaceDirectory: string;
  githubToken?: string;
  testRepository?: string;
  testFolder?: string;
  repositoryDirectories?: Record<string, string>;
  git?: RegressionGitRunner;
}): Promise<RegressionPlan> {
  const request = parseRegressionRequest(options.request);
  const testRepository =
    options.testRepository === undefined
      ? undefined
      : normalizeRegressionRepository(options.testRepository);
  const policyMissing = options.policy === undefined || options.policy === null;
  if (policyMissing && !testRepository)
    throw new RegressionValidationError(
      'An immutable test repository is required when no regression policy is configured.',
    );
  const policy = parseRegressionPolicy(
    policyMissing
      ? {
          version: 1,
          repositories: [{ repository: testRepository }],
          dependencies: [],
          journeys: [],
        }
      : options.policy,
  );
  const issues = policyMissing
    ? ['No saved regression mapping is configured']
    : [];
  const git = options.git || runRegressionGit;
  const environment = regressionGitEnvironment(options.githubToken);
  const gitArgs = [
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'protocol.file.allow=never',
    '-c',
    'protocol.ext.allow=never',
  ];
  const deadline = Date.now() + 5 * 60_000;
  const execute = (
    args: string[],
    cwd?: string,
    maxOutputBytes: number = REGRESSION_LIMITS.snapshotBytes,
  ) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      throw new Error(
        'Regression repository inspection exceeded its time limit.',
      );
    return git([...gitArgs, ...args], {
      cwd,
      environment,
      maxOutputBytes,
      timeoutMs: Math.min(60_000, remaining),
    });
  };
  const directories = Object.fromEntries(
    Object.entries(options.repositoryDirectories || {}).map(
      ([name, directory]) => [normalizeRegressionRepository(name), directory],
    ),
  );
  const snapshots: RegressionSnapshot[] = [];
  const changes: RegressionChange[] = [];
  await fs.mkdir(options.workspaceDirectory, { recursive: true });
  const cache = await fs.mkdtemp(
    path.join(options.workspaceDirectory, 'regression-snapshots-'),
  );
  const authorized = new Set(
    policy.repositories.map((item) => item.repository),
  );
  if (testRepository) authorized.add(testRepository);
  for (const source of request.sources) {
    if (!authorized.has(source.repository))
      issues.push(
        `Changed repository has no mapping in this test node: ${source.repository}`,
      );
  }
  // The test repository can be authorized by the saved node without explicit mappings.
  const configured = [...policy.repositories];
  if (
    testRepository &&
    !configured.some((item) => item.repository === testRepository) &&
    request.sources.some((source) => source.repository === testRepository)
  )
    configured.push({ repository: testRepository });
  try {
    for (const configuredRepository of configured) {
      const repository = configuredRepository.repository;
      const source = request.sources.find(
        (item) => item.repository === repository,
      );
      let directory = directories[repository];
      let revision = source?.headSha || configuredRepository.revision;
      const injected = Boolean(directory);
      if (!revision && repository === testRepository && directory) {
        try {
          revision = normalizeRegressionRevision(
            (
              await execute(
                ['rev-parse', '--verify', 'HEAD^{commit}'],
                directory,
                4096,
              )
            )
              .toString('utf8')
              .trim(),
          );
        } catch {
          issues.push(`Cannot pin unchanged test repository ${repository}`);
          continue;
        }
      }
      if (!revision) {
        issues.push(
          `Unchanged consumer repository requires an immutable revision: ${repository}`,
        );
        continue;
      }
      if (!directory) {
        directory = path.join(cache, repository.replace('/', '--'));
        await fs.mkdir(directory, { recursive: true });
        await execute(['init', '--bare', directory], undefined, 4096);
      }
      const verify = async (sha: string) => {
        const read = async () =>
          normalizeRegressionRevision(
            (
              await execute(
                ['rev-parse', '--verify', `${sha}^{commit}`],
                directory,
                4096,
              )
            )
              .toString('utf8')
              .trim(),
          );
        let actual: string;
        try {
          actual = await read();
        } catch {
          // Injected directories are read-only snapshots supplied by the trusted caller.
          // Missing objects are fetched into our private bare cache instead.
          if (injected) {
            const localDirectory = path.join(
              cache,
              repository.replace('/', '--'),
            );
            await fs.mkdir(localDirectory, { recursive: true });
            await execute(['init', '--bare', localDirectory], undefined, 4096);
            directory = localDirectory;
          }
          await execute(
            [
              'fetch',
              '--no-tags',
              '--depth=1',
              '--no-recurse-submodules',
              `https://github.com/${repository}.git`,
              sha,
            ],
            directory,
            64 * 1024,
          );
          actual = await read();
        }
        if (actual !== sha) throw new Error('Git resolved a different commit.');
      };
      try {
        // Failed candidate verification is a blocked run, not permission to test another revision.
        await verify(revision);
        if (source) await verify(source.baseSha);
        // Fetching an absent base from an injected shallow checkout moves into
        // the private cache, so verify/fetch the head there too.
        await verify(revision);
      } catch {
        throw new RegressionValidationError(
          `Could not verify immutable regression revisions for ${repository}.`,
        );
      }
      if (source) {
        try {
          changes.push(
            ...parseDiff(
              repository,
              await execute(
                [
                  'diff',
                  '--no-ext-diff',
                  '--no-textconv',
                  '--name-status',
                  '-z',
                  '--find-renames=90%',
                  source.baseSha,
                  source.headSha,
                  '--',
                ],
                directory,
                2 * 1024 * 1024,
              ),
            ),
          );
        } catch {
          issues.push(
            `Changed-file inspection was incomplete for ${repository}`,
          );
        }
      }
      for (const sha of [
        ...new Set(source ? [source.baseSha, source.headSha] : [revision]),
      ]) {
        try {
          const entries = treeEntries(
            await execute(
              ['ls-tree', '-r', '-l', '-z', '--full-tree', sha],
              directory,
              4 * 1024 * 1024,
            ),
          );
          const files: Record<string, string | null> = Object.create(null);
          let bytes = 0;
          for (const entry of entries) {
            files[entry.path] = null;
            if (entry.mode !== '100644' && entry.mode !== '100755') {
              issues.push(
                `Unsupported symlink/submodule source ${repository}:${entry.path}`,
              );
              continue;
            }
            if (
              !/\.(?:[cm]?[jt]sx?)$/i.test(entry.path) &&
              path.posix.basename(entry.path) !== 'package.json'
            )
              continue;
            if (
              entry.size > REGRESSION_LIMITS.fileBytes ||
              bytes + entry.size > REGRESSION_LIMITS.snapshotBytes
            ) {
              issues.push(
                `Source snapshot exceeds the supported size: ${repository}:${entry.path}`,
              );
              continue;
            }
            const content = await execute(
              ['cat-file', 'blob', entry.objectId],
              directory,
              REGRESSION_LIMITS.fileBytes,
            );
            bytes += content.length;
            if (
              content.includes(0) ||
              !Buffer.from(content.toString('utf8')).equals(content)
            ) {
              issues.push(
                `Unsupported binary source ${repository}:${entry.path}`,
              );
              continue;
            }
            files[entry.path] = content.toString('utf8');
          }
          snapshots.push({ repository, revision: sha, files });
        } catch {
          issues.push(
            `Source snapshot inspection was incomplete for ${repository}@${sha}`,
          );
        }
      }
    }
    return buildRegressionPlan({
      request,
      policy,
      snapshots,
      changes,
      issues,
      testRepository,
      testFolder: options.testFolder,
    });
  } finally {
    await fs.rm(cache, { recursive: true, force: true });
  }
}
