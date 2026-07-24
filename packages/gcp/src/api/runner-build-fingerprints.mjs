/* global console, process */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  '.turbo',
  '.vite',
  'dist',
  'node_modules',
]);
const IGNORED_FILE_PATHS = new Set([
  'src/generated/package-contributions.ts',
  'src/integrations/generated-package-contributions.ts',
]);

async function fileExists(filePath) {
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

async function findFiles(directory, rootDirectory) {
  if (!(await fileExists(directory))) return [];
  const files = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRECTORY_NAMES.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findFiles(absolutePath, rootDirectory)));
      continue;
    }
    if (!entry.isFile()) continue;

    const relativePath = path
      .relative(rootDirectory, absolutePath)
      .split(path.sep)
      .join('/');
    if (
      Array.from(IGNORED_FILE_PATHS).some((ignoredPath) =>
        relativePath.endsWith(ignoredPath),
      )
    ) {
      continue;
    }
    files.push({ absolutePath, relativePath });
  }
  return files;
}

async function localPackageDirectories(appDirectory) {
  const manifestPath = path.join(appDirectory, 'package.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const dependencies = {
    ...(manifest.dependencies || {}),
    ...(manifest.optionalDependencies || {}),
  };
  const directories = [];
  for (const dependencyValue of Object.values(dependencies)) {
    if (
      typeof dependencyValue !== 'string' ||
      !dependencyValue.startsWith('file:')
    ) {
      continue;
    }
    directories.push(
      path.resolve(appDirectory, dependencyValue.slice('file:'.length)),
    );
  }
  return directories;
}

async function hashInputs({ descriptors, directories, files, repoRoot }) {
  const inputs = [];
  for (const directory of directories) {
    inputs.push(...(await findFiles(directory, repoRoot)));
  }
  for (const filePath of files) {
    if (!(await fileExists(filePath))) continue;
    inputs.push({
      absolutePath: filePath,
      relativePath: path.relative(repoRoot, filePath).split(path.sep).join('/'),
    });
  }

  const uniqueInputs = Array.from(
    new Map(inputs.map((input) => [input.relativePath, input])).values(),
  ).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const hash = crypto.createHash('sha256');
  for (const descriptor of descriptors.sort()) {
    hash.update('descriptor\0');
    hash.update(descriptor);
    hash.update('\0');
  }
  for (const input of uniqueInputs) {
    hash.update('file\0');
    hash.update(input.relativePath);
    hash.update('\0');
    hash.update(await fs.readFile(input.absolutePath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export async function findPlayrunnerRepoRoot(startDirectory = process.cwd()) {
  let current = path.resolve(startDirectory);
  for (;;) {
    if (
      (await fileExists(
        path.join(current, 'infra/gcp/scripts/push-runners.sh'),
      )) &&
      (await fileExists(path.join(current, 'apps/runners')))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function getOrchestratorBuildFingerprint({
  basePath = '.',
  repoRoot,
}) {
  const appDirectory = path.resolve(
    repoRoot,
    basePath,
    'apps/runners/orchestrator',
  );
  const resolvedAppDirectory = (await fileExists(appDirectory))
    ? appDirectory
    : path.join(repoRoot, 'apps/runners/orchestrator');
  const packageDirectories =
    await localPackageDirectories(resolvedAppDirectory);
  return hashInputs({
    descriptors: ['runner=orchestrator', `basePath=${basePath}`],
    directories: [resolvedAppDirectory, ...packageDirectories],
    files: [
      path.join(repoRoot, '.dockerignore'),
      path.join(repoRoot, 'apps/runners/orchestrator/Dockerfile'),
      path.join(repoRoot, 'infra/scripts/generate-integration-composition.mjs'),
    ],
    repoRoot,
  });
}

export async function getPlaywrightBuildFingerprint({
  repoRoot,
  runtime,
  version,
}) {
  if (!['python', 'typescript'].includes(runtime)) {
    throw new Error(`Unsupported Playwright runtime: ${runtime}.`);
  }
  const appDirectory = path.join(repoRoot, 'apps/runners/playwright');
  return hashInputs({
    descriptors: [
      'runner=playwright',
      `runtime=${runtime}`,
      `version=${version}`,
    ],
    directories: [appDirectory],
    files: [
      path.join(repoRoot, '.dockerignore'),
      path.join(repoRoot, `apps/runners/playwright/Dockerfile.${runtime}`),
      path.join(repoRoot, 'config/playwright-runner-versions.json'),
    ],
    repoRoot,
  });
}

export async function getRunnerBuildFingerprints({ basePath = '.', repoRoot }) {
  const config = JSON.parse(
    await fs.readFile(
      path.join(repoRoot, 'config/playwright-runner-versions.json'),
      'utf8',
    ),
  );
  const versions = Array.isArray(config.versions) ? config.versions : [];
  const playwright = [];
  for (const runtime of ['typescript', 'python']) {
    for (const version of versions) {
      if (typeof version?.tag !== 'string' || !version.tag) continue;
      playwright.push({
        fingerprint: await getPlaywrightBuildFingerprint({
          repoRoot,
          runtime,
          version: version.tag,
        }),
        publishAsLatest: version.publishAsLatest === true,
        runtime,
        version: version.tag,
      });
    }
  }
  return {
    orchestrator: {
      fingerprint: await getOrchestratorBuildFingerprint({
        basePath,
        repoRoot,
      }),
    },
    playwright,
  };
}

function readArgument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const currentFile = fileURLToPath(import.meta.url);
async function runCli() {
  const target = process.argv[2];
  const repoRoot =
    readArgument('--repo-root') ||
    (await findPlayrunnerRepoRoot(process.cwd()));
  if (!repoRoot) throw new Error('Unable to locate the Playrunner repo root.');

  if (target === 'orchestrator') {
    console.log(
      await getOrchestratorBuildFingerprint({
        basePath: readArgument('--base-path', '.'),
        repoRoot,
      }),
    );
  } else if (target === 'playwright') {
    console.log(
      await getPlaywrightBuildFingerprint({
        repoRoot,
        runtime: readArgument('--runtime'),
        version: readArgument('--version'),
      }),
    );
  } else if (target === 'json') {
    console.log(
      JSON.stringify(
        await getRunnerBuildFingerprints({
          basePath: readArgument('--base-path', '.'),
          repoRoot,
        }),
      ),
    );
  } else {
    throw new Error(
      'Usage: runner-build-fingerprints.mjs orchestrator|playwright|json [options]',
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  void runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
