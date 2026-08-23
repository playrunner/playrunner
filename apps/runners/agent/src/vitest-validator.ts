import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runProcess, type ProcessResult } from './process';

export const VITEST_COVERAGE_DIRECTORY = 'test-results/vitest-coverage';
export const VITEST_COVERAGE_REPORT = `${VITEST_COVERAGE_DIRECTORY}/coverage-final.json`;
export const VITEST_LCOV_REPORT = `${VITEST_COVERAGE_DIRECTORY}/lcov.info`;
export const VITEST_RESULTS_REPORT = 'test-results/vitest-results.json';

export const VITEST_UNIT_TEST_GLOBS = [
  '**/*.unit.test.{js,jsx,ts,tsx,mjs,mts,cjs,cts}',
  '**/*.unit.spec.{js,jsx,ts,tsx,mjs,mts,cjs,cts}',
] as const;

export const VITEST_PRODUCTION_GLOBS = [
  'src/**/*.{js,jsx,ts,tsx,mjs,mts,cjs,cts}',
  'app/**/*.{js,jsx,ts,tsx,mjs,mts,cjs,cts}',
  'lib/**/*.{js,jsx,ts,tsx,mjs,mts,cjs,cts}',
  'server/**/*.{js,jsx,ts,tsx,mjs,mts,cjs,cts}',
  'client/**/*.{js,jsx,ts,tsx,mjs,mts,cjs,cts}',
  'api/**/*.{js,jsx,ts,tsx,mjs,mts,cjs,cts}',
  'apps/*/**/*.{js,jsx,ts,tsx,mjs,mts,cjs,cts}',
  'packages/*/**/*.{js,jsx,ts,tsx,mjs,mts,cjs,cts}',
] as const;

export const VITEST_PRODUCTION_EXCLUDE_GLOBS = [
  '**/*.d.{ts,mts,cts}',
  '**/*.{test,spec}.{js,jsx,ts,tsx,mjs,mts,cjs,cts}',
  '**/*.unit.{test,spec}.{js,jsx,ts,tsx,mjs,mts,cjs,cts}',
  '**/*.config.{js,jsx,ts,tsx,mjs,mts,cjs,cts}',
  '**/{test,tests,__tests__,spec,specs,e2e,fixtures,__fixtures__,mocks,__mocks__}/**',
  '**/{generated,__generated__,dist,build,out,coverage,test-results,node_modules,.next,.cache,.turbo,.git}/**',
] as const;

const MAX_REPORT_BYTES = 100 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const MAX_TIMEOUT_MS = 120 * 60_000;
const MAX_INVENTORY_DEPTH = 64;
const MAX_INVENTORY_ENTRIES = 100_000;
const MAX_INVENTORY_FILES = 25_000;
const MAX_MONOREPO_PROJECTS = 2_000;

const PRODUCTION_ROOT_NAMES = [
  'src',
  'app',
  'lib',
  'server',
  'client',
  'api',
] as const;
const PRODUCTION_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.mts',
  '.cjs',
  '.cts',
]);
const EXCLUDED_SOURCE_DIRECTORIES = new Set([
  '.cache',
  '.git',
  '.next',
  '.turbo',
  '__fixtures__',
  '__generated__',
  '__mocks__',
  '__tests__',
  'build',
  'coverage',
  'dist',
  'e2e',
  'fixtures',
  'generated',
  'mocks',
  'node_modules',
  'out',
  'spec',
  'specs',
  'test',
  'test-results',
  'tests',
]);

type RunCommand = (
  command: string,
  args: string[],
  options: NonNullable<Parameters<typeof runProcess>[2]>,
) => Promise<ProcessResult>;

export type VitestCoverageFailure =
  | 'branch_coverage'
  | 'coverage_missing'
  | 'invalid_coverage'
  | 'invalid_test_results'
  | 'line_coverage'
  | 'no_tests'
  | 'output_truncated'
  | 'test_failure'
  | 'timeout';

export type VitestCoverageRunResult = ProcessResult & {
  args: string[];
  branchCoverage: number | null;
  command: 'vitest';
  coverageReportPath: string | null;
  failure: VitestCoverageFailure | null;
  failureMessage: string | null;
  lcovReportPath: string | null;
  lineCoverage: number | null;
  passed: boolean;
  testCount: number | null;
  testResultsPath: string | null;
};

export type VitestCoverageOptions = {
  environment?: NodeJS.ProcessEnv;
  gid?: number;
  maxOutputBytes?: number;
  minimumBranchCoverage?: number;
  minimumLineCoverage?: number;
  runCommand?: RunCommand;
  timeoutMs?: number;
  uid?: number;
};

function reportPath(root: string, relativePath: string): string {
  return path.join(root, ...relativePath.split('/'));
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`))
  );
}

type ProductionSourceInventory = {
  failureMessage: string | null;
  files: Set<string>;
};

type InventoryCoverageSource = {
  failureMessage: string | null;
  source: string | null;
};

function normalizedRelativePath(
  root: string,
  candidate: string,
): string | null {
  const relative = path.relative(root, candidate);
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`)
  ) {
    return null;
  }
  return relative.split(path.sep).join('/');
}

function isExcludedProductionFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return (
    /\.d\.(?:ts|mts|cts)$/.test(lower) ||
    /\.(?:test|spec)\.(?:js|jsx|ts|tsx|mjs|mts|cjs|cts)$/.test(lower) ||
    /^(?:test|spec)\.(?:js|jsx|ts|tsx|mjs|mts|cjs|cts)$/.test(lower) ||
    /\.config\.(?:js|jsx|ts|tsx|mjs|mts|cjs|cts)$/.test(lower) ||
    /(?:^|[._-])(?:generated|gen)\.(?:js|jsx|ts|tsx|mjs|mts|cjs|cts)$/.test(
      lower,
    )
  );
}

function productionSourceInventory(root: string): ProductionSourceInventory {
  const files = new Set<string>();
  let entries = 0;
  let projects = 0;
  let failureMessage: string | null = null;

  const fail = (message: string): void => {
    failureMessage ||= message;
  };

  const scan = (start: string): void => {
    const stack: Array<{ depth: number; directory: string }> = [
      { depth: 0, directory: start },
    ];
    while (stack.length && !failureMessage) {
      const current = stack.pop();
      if (!current) break;
      if (current.depth > MAX_INVENTORY_DEPTH) {
        fail(
          `Production source inventory exceeded the maximum directory depth of ${MAX_INVENTORY_DEPTH}.`,
        );
        break;
      }
      let directory: fs.Dir | undefined;
      try {
        directory = fs.opendirSync(current.directory);
        let entry: fs.Dirent | null;
        while ((entry = directory.readSync()) !== null) {
          entries += 1;
          if (entries > MAX_INVENTORY_ENTRIES) {
            fail(
              `Production source inventory exceeded the maximum of ${MAX_INVENTORY_ENTRIES} filesystem entries.`,
            );
            break;
          }
          const lowerName = entry.name.toLowerCase();
          if (EXCLUDED_SOURCE_DIRECTORIES.has(lowerName)) continue;
          const absolute = path.join(current.directory, entry.name);
          if (entry.isSymbolicLink()) {
            fail(
              `Production source inventory does not follow symbolic links (${normalizedRelativePath(root, absolute) || entry.name}).`,
            );
            break;
          }
          if (entry.isDirectory()) {
            stack.push({
              depth: current.depth + 1,
              directory: absolute,
            });
            continue;
          }
          if (
            !entry.isFile() ||
            !PRODUCTION_EXTENSIONS.has(path.extname(lowerName)) ||
            isExcludedProductionFile(lowerName)
          ) {
            continue;
          }
          const relative = normalizedRelativePath(root, absolute);
          if (!relative) {
            fail(
              'Production source inventory found a file outside the workspace.',
            );
            break;
          }
          files.add(relative);
          if (files.size > MAX_INVENTORY_FILES) {
            fail(
              `Production source inventory exceeded the maximum of ${MAX_INVENTORY_FILES} supported source files.`,
            );
            break;
          }
        }
      } catch (error) {
        fail(
          `Production source inventory could not read ${normalizedRelativePath(root, current.directory) || current.directory}: ${error instanceof Error ? error.message : String(error)}.`,
        );
      } finally {
        directory?.closeSync();
      }
    }
  };

  const addRoot = (candidate: string): void => {
    if (failureMessage || !fs.existsSync(candidate)) return;
    try {
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink()) {
        fail(
          `Production source root cannot be a symbolic link (${normalizedRelativePath(root, candidate) || candidate}).`,
        );
      } else if (stat.isDirectory()) {
        scan(candidate);
      }
    } catch (error) {
      fail(
        `Production source inventory could not inspect ${normalizedRelativePath(root, candidate) || candidate}: ${error instanceof Error ? error.message : String(error)}.`,
      );
    }
  };

  for (const rootName of PRODUCTION_ROOT_NAMES) {
    addRoot(path.join(root, rootName));
  }
  for (const workspaceName of ['apps', 'packages']) {
    if (failureMessage) break;
    const workspaceRoot = path.join(root, workspaceName);
    if (!fs.existsSync(workspaceRoot)) continue;
    let directory: fs.Dir | undefined;
    try {
      const stat = fs.lstatSync(workspaceRoot);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        fail(
          `Monorepo source root ${workspaceName} must be a regular directory.`,
        );
        break;
      }
      directory = fs.opendirSync(workspaceRoot);
      let entry: fs.Dirent | null;
      while ((entry = directory.readSync()) !== null) {
        entries += 1;
        if (entries > MAX_INVENTORY_ENTRIES) {
          fail(
            `Production source inventory exceeded the maximum of ${MAX_INVENTORY_ENTRIES} filesystem entries.`,
          );
          break;
        }
        if (EXCLUDED_SOURCE_DIRECTORIES.has(entry.name.toLowerCase())) {
          continue;
        }
        const projectRoot = path.join(workspaceRoot, entry.name);
        if (entry.isSymbolicLink()) {
          fail(
            `Monorepo source project cannot be a symbolic link (${workspaceName}/${entry.name}).`,
          );
          break;
        }
        if (entry.isDirectory()) {
          projects += 1;
          if (projects > MAX_MONOREPO_PROJECTS) {
            fail(
              `Production source inventory exceeded the maximum of ${MAX_MONOREPO_PROJECTS} monorepo projects.`,
            );
            break;
          }
          scan(projectRoot);
        }
      }
    } catch (error) {
      fail(
        `Production source inventory could not inspect ${workspaceName}: ${error instanceof Error ? error.message : String(error)}.`,
      );
    } finally {
      directory?.closeSync();
    }
  }

  if (!failureMessage && files.size === 0) {
    failureMessage =
      'No supported production JavaScript or TypeScript source was found in src, app, lib, server, client, api, apps/*, or packages/*.';
  }
  return { failureMessage, files };
}

function coverageSourceForInventory(
  source: string | null,
  root: string,
  inventory: ProductionSourceInventory,
): InventoryCoverageSource {
  if (inventory.failureMessage) {
    return { failureMessage: inventory.failureMessage, source: null };
  }
  if (!source) return { failureMessage: null, source: null };
  try {
    const value = JSON.parse(source) as Record<string, unknown>;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {
        failureMessage: 'Vitest coverage was not a detailed file map.',
        source: null,
      };
    }
    const included: Record<string, unknown> = {};
    const seen = new Set<string>();
    for (const [fileName, candidate] of Object.entries(value)) {
      const absolute = path.isAbsolute(fileName)
        ? path.resolve(fileName)
        : path.resolve(root, fileName);
      const relative = normalizedRelativePath(root, absolute);
      if (!relative) {
        return {
          failureMessage:
            'Vitest coverage referenced a file outside the validation workspace.',
          source: null,
        };
      }
      if (!inventory.files.has(relative)) continue;
      if (seen.has(relative)) {
        return {
          failureMessage: `Vitest coverage contained duplicate entries for ${relative}.`,
          source: null,
        };
      }
      seen.add(relative);
      included[fileName] = candidate;
    }
    const missing = [...inventory.files]
      .filter((file) => !seen.has(file))
      .sort();
    if (missing.length) {
      const examples = missing.slice(0, 5).join(', ');
      const suffix =
        missing.length > 5 ? ` and ${missing.length - 5} more` : '';
      return {
        failureMessage: `Detailed Vitest coverage omitted ${missing.length} inventoried production source file${missing.length === 1 ? '' : 's'}: ${examples}${suffix}.`,
        source: null,
      };
    }
    return { failureMessage: null, source: JSON.stringify(included) };
  } catch {
    return {
      failureMessage: 'Vitest coverage was not valid JSON.',
      source: null,
    };
  }
}

function ensureSafeResultsDirectory(
  root: string,
  owner: { gid?: number; uid?: number } = {},
): void {
  const results = reportPath(root, 'test-results');
  if (!fs.existsSync(results)) fs.mkdirSync(results, { mode: 0o755 });
  const stat = fs.lstatSync(results);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    !isInside(root, fs.realpathSync(results))
  ) {
    throw new Error(
      'Vitest test-results must be a regular directory inside the validation workspace.',
    );
  }
  if (owner.uid !== undefined || owner.gid !== undefined) {
    fs.chownSync(results, owner.uid ?? stat.uid, owner.gid ?? stat.gid);
  }
}

function removeStaleArtifacts(
  root: string,
  owner: { gid?: number; uid?: number } = {},
): void {
  ensureSafeResultsDirectory(root, owner);
  fs.rmSync(reportPath(root, VITEST_COVERAGE_DIRECTORY), {
    force: true,
    recursive: true,
  });
  fs.rmSync(reportPath(root, VITEST_RESULTS_REPORT), { force: true });
}

function readFreshRegularFile(
  root: string,
  relativePath: string,
  startedAtMs: number,
): string | null {
  let descriptor: number | undefined;
  try {
    ensureSafeResultsDirectory(root);
    const filePath = reportPath(root, relativePath);
    const stat = fs.lstatSync(filePath);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size < 1 ||
      stat.size > MAX_REPORT_BYTES ||
      stat.mtimeMs + 1_000 < startedAtMs ||
      !isInside(root, fs.realpathSync(filePath))
    ) {
      return null;
    }
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    );
    const opened = fs.fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.dev !== stat.dev ||
      opened.ino !== stat.ino ||
      opened.size !== stat.size
    ) {
      return null;
    }
    return fs.readFileSync(descriptor, 'utf8');
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

const MAX_REPORTED_TESTS = 100_000;
const EXPLICIT_UNIT_TEST_FILE =
  /\.unit\.(?:test|spec)\.(?:js|jsx|ts|tsx|mjs|mts|cjs|cts)$/;

function reportedCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function reportedUnitTestFile(root: string, value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.includes('\0')) return null;
  const absolute = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(root, value);
  const relative = path.relative(root, absolute).replaceAll('\\', '/');
  if (
    !relative ||
    !isInside(root, absolute) ||
    !EXPLICIT_UNIT_TEST_FILE.test(relative)
  ) {
    return null;
  }
  try {
    const stat = fs.lstatSync(absolute);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      !isInside(root, fs.realpathSync(absolute))
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return relative;
}

function testCountFromReport(
  source: string | null,
  root: string,
): number | null {
  if (!source) return null;
  try {
    const value = JSON.parse(source) as Record<string, unknown>;
    const total = reportedCount(value.numTotalTests);
    const passed = reportedCount(value.numPassedTests);
    const failed = reportedCount(value.numFailedTests);
    const pending = reportedCount(value.numPendingTests);
    const todo = reportedCount(value.numTodoTests);
    if (
      total === null ||
      total > MAX_REPORTED_TESTS ||
      passed === null ||
      failed === null ||
      pending === null ||
      todo === null ||
      value.success !== true ||
      failed !== 0 ||
      pending !== 0 ||
      todo !== 0 ||
      passed !== total ||
      !Array.isArray(value.testResults) ||
      value.testResults.length > MAX_REPORTED_TESTS
    ) {
      return null;
    }
    let passedAssertions = 0;
    let failedAssertions = 0;
    let pendingAssertions = 0;
    let todoAssertions = 0;
    const reportedFiles = new Set<string>();
    for (const fileValue of value.testResults) {
      if (
        !fileValue ||
        typeof fileValue !== 'object' ||
        Array.isArray(fileValue)
      ) {
        return null;
      }
      const file = fileValue as Record<string, unknown>;
      const fileName = reportedUnitTestFile(root, file.name);
      if (
        !fileName ||
        reportedFiles.has(fileName) ||
        file.status !== 'passed'
      ) {
        return null;
      }
      reportedFiles.add(fileName);
      if (!Array.isArray(file.assertionResults)) return null;
      for (const assertionValue of file.assertionResults) {
        if (
          !assertionValue ||
          typeof assertionValue !== 'object' ||
          Array.isArray(assertionValue)
        ) {
          return null;
        }
        const status = (assertionValue as Record<string, unknown>).status;
        if (status === 'passed') passedAssertions += 1;
        else if (status === 'failed') failedAssertions += 1;
        else if (status === 'pending') pendingAssertions += 1;
        else if (status === 'todo') todoAssertions += 1;
        else return null;
        if (
          passedAssertions +
            failedAssertions +
            pendingAssertions +
            todoAssertions >
          MAX_REPORTED_TESTS
        ) {
          return null;
        }
      }
    }
    if (
      passedAssertions !== passed ||
      failedAssertions !== failed ||
      pendingAssertions !== pending ||
      todoAssertions !== todo ||
      passedAssertions +
        failedAssertions +
        pendingAssertions +
        todoAssertions !==
        total
    ) {
      return null;
    }
    return total;
  } catch {
    return null;
  }
}

type CoverageMetrics = {
  branchCoverage: number | null;
  lineCoverage: number | null;
  valid: boolean;
};

function percentage(covered: number, total: number): number | null {
  return total > 0 ? (covered / total) * 100 : null;
}

function coverageMetrics(source: string | null, root: string): CoverageMetrics {
  const invalid = (): CoverageMetrics => ({
    branchCoverage: null,
    lineCoverage: null,
    valid: false,
  });
  if (!source) return invalid();
  try {
    const value = JSON.parse(source) as Record<string, unknown>;
    let branchCovered = 0;
    let branchTotal = 0;
    let lineCovered = 0;
    let lineTotal = 0;
    let measuredFiles = 0;
    for (const [fileName, candidate] of Object.entries(value)) {
      const absoluteFile = path.isAbsolute(fileName)
        ? path.resolve(fileName)
        : path.resolve(root, fileName);
      const relativeFile = path.relative(root, absoluteFile);
      if (
        !relativeFile ||
        path.isAbsolute(relativeFile) ||
        relativeFile === '..' ||
        relativeFile.startsWith(`..${path.sep}`)
      ) {
        return invalid();
      }
      if (
        !candidate ||
        typeof candidate !== 'object' ||
        Array.isArray(candidate)
      ) {
        return invalid();
      }
      const file = candidate as Record<string, unknown>;
      if (
        !file.statementMap ||
        typeof file.statementMap !== 'object' ||
        Array.isArray(file.statementMap) ||
        !file.s ||
        typeof file.s !== 'object' ||
        Array.isArray(file.s) ||
        !file.branchMap ||
        typeof file.branchMap !== 'object' ||
        Array.isArray(file.branchMap) ||
        !file.b ||
        typeof file.b !== 'object' ||
        Array.isArray(file.b)
      ) {
        return invalid();
      }
      const statements = file.statementMap as Record<string, unknown>;
      const hits = file.s as Record<string, unknown>;
      if (
        Object.keys(statements).length !== Object.keys(hits).length ||
        Object.keys(statements).some((id) => !(id in hits))
      ) {
        return invalid();
      }
      const branchMap = file.branchMap as Record<string, unknown>;
      const branchHits = file.b as Record<string, unknown>;
      const branchIds = Object.keys(branchMap);
      if (
        branchIds.length !== Object.keys(branchHits).length ||
        branchIds.some((id) => !(id in branchHits))
      ) {
        return invalid();
      }
      const lines = new Map<number, number>();
      for (const [id, locationValue] of Object.entries(statements)) {
        const location = locationValue as Record<string, unknown> | null;
        const start = location?.start as Record<string, unknown> | undefined;
        const line = Number(start?.line);
        const hit = Number(hits[id]);
        if (
          !Number.isSafeInteger(line) ||
          line < 1 ||
          !Number.isSafeInteger(hit) ||
          hit < 0
        ) {
          return invalid();
        }
        lines.set(line, Math.max(lines.get(line) || 0, hit));
      }
      if (lines.size) measuredFiles += 1;
      lineTotal += lines.size;
      lineCovered += [...lines.values()].filter((hit) => hit > 0).length;
      for (const [id, branchValue] of Object.entries(branchHits)) {
        const branch = branchMap[id];
        const branchRecord =
          branch && typeof branch === 'object' && !Array.isArray(branch)
            ? (branch as Record<string, unknown>)
            : null;
        const locations = branchRecord?.locations;
        if (
          !branchRecord ||
          !Array.isArray(locations) ||
          !Array.isArray(branchValue) ||
          locations.length < 1 ||
          locations.length !== branchValue.length ||
          branchValue.some(
            (hit) =>
              typeof hit !== 'number' || !Number.isSafeInteger(hit) || hit < 0,
          )
        ) {
          return invalid();
        }
        branchTotal += branchValue.length;
        branchCovered += branchValue.filter((hit) => hit > 0).length;
      }
    }
    return {
      branchCoverage:
        branchTotal === 0 ? 100 : percentage(branchCovered, branchTotal),
      lineCoverage: percentage(lineCovered, lineTotal),
      valid: measuredFiles > 0 && lineTotal > 0,
    };
  } catch {
    return invalid();
  }
}

function validatorConfig(root: string): string {
  return `export default ${JSON.stringify({
    root,
    test: {
      expect: {
        requireAssertions: true,
      },
      coverage: {
        enabled: true,
        exclude: [
          ...VITEST_UNIT_TEST_GLOBS,
          ...VITEST_PRODUCTION_EXCLUDE_GLOBS,
        ],
        include: [...VITEST_PRODUCTION_GLOBS],
        provider: 'v8',
        reporter: ['json', 'lcov'],
        reportsDirectory: VITEST_COVERAGE_DIRECTORY,
      },
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/coverage/**',
        '**/test-results/**',
      ],
      fileParallelism: false,
      include: [...VITEST_UNIT_TEST_GLOBS],
      passWithNoTests: false,
      retry: 0,
    },
  })};\n`;
}

function fixedArguments(configPath: string, root: string): string[] {
  return [
    'run',
    '--config',
    configPath,
    '--root',
    root,
    '--reporter=json',
    `--outputFile=${VITEST_RESULTS_REPORT}`,
    '--coverage.enabled=true',
    '--coverage.provider=v8',
    '--coverage.reporter=json',
    '--coverage.reporter=lcov',
    `--coverage.reportsDirectory=${VITEST_COVERAGE_DIRECTORY}`,
    '--passWithNoTests=false',
    '--no-color',
  ];
}

function failureFor(
  processResult: ProcessResult,
  testCount: number | null,
  coverageSource: string | null,
  inventoryFailureMessage: string | null,
  metrics: CoverageMetrics,
  minimumLineCoverage: number,
  minimumBranchCoverage: number,
): Pick<VitestCoverageRunResult, 'failure' | 'failureMessage'> {
  if (processResult.timedOut) {
    return {
      failure: 'timeout',
      failureMessage: 'The authoritative Vitest unit coverage run timed out.',
    };
  }
  if (processResult.stdoutTruncated || processResult.stderrTruncated) {
    return {
      failure: 'output_truncated',
      failureMessage:
        'The authoritative Vitest output exceeded its bounded capture limit.',
    };
  }
  if (
    testCount === 0 ||
    (testCount === null &&
      /(?:no test files found|no tests found)/i.test(
        `${processResult.stdout}\n${processResult.stderr}`,
      ))
  ) {
    return {
      failure: 'no_tests',
      failureMessage:
        'No explicit *.unit.test.* or *.unit.spec.* files were executed.',
    };
  }
  if (processResult.code !== 0) {
    return {
      failure: 'test_failure',
      failureMessage: `The authoritative Vitest unit coverage run exited with code ${processResult.code}.`,
    };
  }
  if (testCount === null) {
    return {
      failure: 'invalid_test_results',
      failureMessage:
        'Vitest did not produce a valid fixed JSON test-results report.',
    };
  }
  if (inventoryFailureMessage) {
    return {
      failure: 'invalid_coverage',
      failureMessage: inventoryFailureMessage,
    };
  }
  if (!coverageSource) {
    return {
      failure: 'coverage_missing',
      failureMessage:
        'Vitest did not produce the fixed detailed coverage report.',
    };
  }
  if (!metrics.valid) {
    return {
      failure: 'invalid_coverage',
      failureMessage:
        'Vitest produced an invalid or empty detailed Istanbul coverage report.',
    };
  }
  if (
    metrics.lineCoverage === null ||
    metrics.lineCoverage < minimumLineCoverage
  ) {
    return {
      failure: 'line_coverage',
      failureMessage: `Vitest line coverage is ${metrics.lineCoverage?.toFixed(1) ?? 'unavailable'}%; required minimum is ${minimumLineCoverage}%.`,
    };
  }
  if (
    minimumBranchCoverage > 0 &&
    (metrics.branchCoverage === null ||
      metrics.branchCoverage < minimumBranchCoverage)
  ) {
    return {
      failure: 'branch_coverage',
      failureMessage: `Vitest branch coverage is ${metrics.branchCoverage?.toFixed(1) ?? 'unavailable'}%; required minimum is ${minimumBranchCoverage}%.`,
    };
  }
  return { failure: null, failureMessage: null };
}

/**
 * Runs the container-owned Vitest binary with a validator-owned configuration.
 * Repository package scripts and repository-selected test names are not used.
 */
export async function runVitestCoverage(
  cwd: string,
  options: VitestCoverageOptions = {},
): Promise<VitestCoverageRunResult> {
  const root = fs.realpathSync(cwd);
  if (!fs.statSync(root).isDirectory()) {
    throw new Error('Vitest validation root must be a directory.');
  }

  const sourceInventory = productionSourceInventory(root);
  removeStaleArtifacts(root, { gid: options.gid, uid: options.uid });
  const configDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'playrunner-vitest-'),
  );
  const configPath = path.join(configDirectory, 'vitest.config.mjs');
  fs.writeFileSync(configPath, validatorConfig(root), { mode: 0o444 });
  // Validation commands run as the unprivileged repository owner. Vite reads
  // the fixed config and writes a transient bundled copy beside it, so expose
  // this secret-free directory with /tmp-style sticky permissions. The root-
  // owned 0444 config cannot be replaced by the dropped-uid process.
  fs.chmodSync(configDirectory, 0o1777);
  const args = fixedArguments(configPath, root);
  const timeoutMs = Math.max(
    1,
    Math.min(MAX_TIMEOUT_MS, options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  );
  const startedAtMs = Date.now();
  let processResult: ProcessResult;
  try {
    processResult = await (options.runCommand ?? runProcess)('vitest', args, {
      cwd: root,
      env: options.environment ?? process.env,
      gid: options.gid,
      maxOutputBytes: options.maxOutputBytes ?? 1_000_000,
      timeoutMs,
      uid: options.uid,
    });
  } finally {
    fs.chmodSync(configDirectory, 0o700);
    fs.rmSync(configDirectory, { force: true, recursive: true });
  }

  const testResultsSource = readFreshRegularFile(
    root,
    VITEST_RESULTS_REPORT,
    startedAtMs,
  );
  const coverageSource = readFreshRegularFile(
    root,
    VITEST_COVERAGE_REPORT,
    startedAtMs,
  );
  const lcovSource = readFreshRegularFile(
    root,
    VITEST_LCOV_REPORT,
    startedAtMs,
  );
  const testCount = testCountFromReport(testResultsSource, root);
  const inventoryCoverage = coverageSourceForInventory(
    coverageSource,
    root,
    sourceInventory,
  );
  const metrics = coverageMetrics(inventoryCoverage.source, root);
  const minimumLineCoverage = Math.min(
    100,
    Math.max(0, Number(options.minimumLineCoverage) || 0),
  );
  const minimumBranchCoverage = Math.min(
    100,
    Math.max(0, Number(options.minimumBranchCoverage) || 0),
  );
  const failure = failureFor(
    processResult,
    testCount,
    coverageSource,
    inventoryCoverage.failureMessage,
    metrics,
    minimumLineCoverage,
    minimumBranchCoverage,
  );

  return {
    ...processResult,
    args,
    branchCoverage: metrics.branchCoverage,
    command: 'vitest',
    coverageReportPath: coverageSource ? VITEST_COVERAGE_REPORT : null,
    ...failure,
    lcovReportPath: lcovSource ? VITEST_LCOV_REPORT : null,
    lineCoverage: metrics.lineCoverage,
    passed: failure.failure === null,
    testCount,
    testResultsPath: testResultsSource ? VITEST_RESULTS_REPORT : null,
  };
}
