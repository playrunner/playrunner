import fs from 'node:fs';
import path from 'node:path';
import { runProcess, type ProcessResult } from './process';
import type { AgentIdentity } from './repository';

const INSTALL_TIMEOUT_MS = 15 * 60_000;
const MAX_INSTALL_OUTPUT_BYTES = 2 * 1024 * 1024;

type RunCommand = (
  command: string,
  args: string[],
  options: NonNullable<Parameters<typeof runProcess>[2]>,
) => Promise<ProcessResult>;

type PackageManager = 'npm' | 'pnpm' | 'yarn';

type ProjectDependencySetup = {
  args: string[];
  command: PackageManager;
  directory: string;
  lockfile: string;
  omittedExternalDevDependencies: boolean;
};

const LOCKFILES: ReadonlyArray<{
  args: string[];
  command: PackageManager;
  name: string;
}> = [
  {
    args: ['ci', '--no-audit', '--no-fund'],
    command: 'npm',
    name: 'npm-shrinkwrap.json',
  },
  {
    args: ['ci', '--no-audit', '--no-fund'],
    command: 'npm',
    name: 'package-lock.json',
  },
  {
    args: ['install', '--frozen-lockfile'],
    command: 'pnpm',
    name: 'pnpm-lock.yaml',
  },
  {
    args: ['install', '--frozen-lockfile', '--non-interactive'],
    command: 'yarn',
    name: 'yarn.lock',
  },
];

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

function regularFile(filePath: string): boolean {
  try {
    return fs.lstatSync(filePath).isFile();
  } catch {
    return false;
  }
}

function hasExternalFileDevDependency(
  repositoryRoot: string,
  directory: string,
): boolean {
  const manifestPath = path.join(directory, 'package.json');
  if (fs.statSync(manifestPath).size > 1024 * 1024) {
    throw new Error('Project package.json exceeds the 1 MiB setup limit.');
  }
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    throw new Error('Project package.json is not valid JSON.');
  }
  const dependencies = manifest.devDependencies;
  if (
    !dependencies ||
    typeof dependencies !== 'object' ||
    Array.isArray(dependencies)
  ) {
    return false;
  }
  return Object.values(dependencies).some((value) => {
    if (typeof value !== 'string' || !value.startsWith('file:')) return false;
    return !isInside(
      repositoryRoot,
      path.resolve(directory, value.slice('file:'.length)),
    );
  });
}

function installArgs(
  manager: (typeof LOCKFILES)[number],
  omitDevDependencies: boolean,
): string[] {
  if (!omitDevDependencies) return manager.args;
  if (manager.command === 'npm') return [...manager.args, '--omit=dev'];
  if (manager.command === 'pnpm') return [...manager.args, '--prod'];
  return [...manager.args, '--production=true'];
}

export function detectProjectDependencySetup(
  repositoryRoot: string,
  workingDirectory: string,
): ProjectDependencySetup {
  const root = fs.realpathSync(repositoryRoot);
  let directory = fs.realpathSync(workingDirectory);
  if (!isInside(root, directory)) {
    throw new Error('Project dependency setup escaped the repository root.');
  }

  while (isInside(root, directory)) {
    const matches = LOCKFILES.filter(({ name }) =>
      regularFile(path.join(directory, name)),
    );
    if (matches.length > 1) {
      throw new Error(
        `Project dependency setup found multiple lockfiles in ${path.relative(root, directory) || '.'}. Keep exactly one package-manager lockfile.`,
      );
    }
    if (matches.length === 1) {
      const match = matches[0];
      if (!regularFile(path.join(directory, 'package.json'))) {
        throw new Error(
          `Project dependency setup found ${match.name} without package.json.`,
        );
      }
      const omittedExternalDevDependencies = hasExternalFileDevDependency(
        root,
        directory,
      );
      return {
        args: installArgs(match, omittedExternalDevDependencies),
        command: match.command,
        directory,
        lockfile: match.name,
        omittedExternalDevDependencies,
      };
    }
    if (directory === root) break;
    directory = path.dirname(directory);
  }

  throw new Error(
    'AI Container requires package-lock.json, npm-shrinkwrap.json, pnpm-lock.yaml, or yarn.lock so it can install project dependencies reproducibly before Codex runs.',
  );
}

function outputTail(result: ProcessResult): string {
  return `${result.stdout}\n${result.stderr}`.trim().slice(-4_000);
}

export async function prepareProjectDependencies(params: {
  containerNodeModulesRoot?: string | null;
  environment: NodeJS.ProcessEnv;
  identity: AgentIdentity;
  repositoryRoot: string;
  runCommand?: RunCommand;
  workingDirectory: string;
}): Promise<ProjectDependencySetup> {
  const setup = detectProjectDependencySetup(
    params.repositoryRoot,
    params.workingDirectory,
  );
  const result = await (params.runCommand ?? runProcess)(
    setup.command,
    setup.args,
    {
      cwd: setup.directory,
      env: {
        ...params.environment,
        CI: '1',
        NPM_CONFIG_AUDIT: 'false',
        NPM_CONFIG_FUND: 'false',
        NPM_CONFIG_UPDATE_NOTIFIER: 'false',
      },
      gid: params.identity.gid,
      maxOutputBytes: MAX_INSTALL_OUTPUT_BYTES,
      timeoutMs: INSTALL_TIMEOUT_MS,
      uid: params.identity.uid,
    },
  );
  if (
    result.code !== 0 ||
    result.timedOut ||
    result.stdoutTruncated ||
    result.stderrTruncated
  ) {
    const reason = result.timedOut
      ? 'timed out'
      : result.stdoutTruncated || result.stderrTruncated
        ? 'exceeded the output limit'
        : `exited with code ${result.code}`;
    throw new Error(
      `Project dependency installation with ${setup.command} ${reason}. ${outputTail(result)}`.trim(),
    );
  }
  const containerNodeModulesRoot =
    params.containerNodeModulesRoot === undefined
      ? '/app/agent/node_modules'
      : params.containerNodeModulesRoot;
  if (containerNodeModulesRoot) {
    const linkScript = `
      const fs = require('node:fs');
      const path = require('node:path');
      const project = process.argv[1];
      const source = process.argv[2];
      for (const name of [
        '@bgotink/playwright-coverage',
        '@playwright/test',
        '@vitest/coverage-v8',
        'playwright',
        'vitest',
      ]) {
        const target = path.join(project, 'node_modules', name);
        const packageSource = path.join(source, name);
        if (!fs.statSync(packageSource).isDirectory()) throw new Error('Container test package is missing: ' + name);
        fs.rmSync(target, { force: true, recursive: true });
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.symlinkSync(packageSource, target, 'dir');
      }
    `;
    const linked = await (params.runCommand ?? runProcess)(
      process.execPath,
      ['-e', linkScript, setup.directory, containerNodeModulesRoot],
      {
        cwd: setup.directory,
        env: params.environment,
        gid: params.identity.gid,
        maxOutputBytes: 64 * 1024,
        timeoutMs: 60_000,
        uid: params.identity.uid,
      },
    );
    if (linked.code !== 0 || linked.timedOut) {
      throw new Error(
        `AI Container could not expose its prebuilt Playwright packages to the project. ${outputTail(linked)}`.trim(),
      );
    }
  }
  return setup;
}
