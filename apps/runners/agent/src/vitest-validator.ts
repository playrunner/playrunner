import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runProcess, type ProcessResult } from './process';

export const VITEST_COVERAGE_DIRECTORY = 'test-results/vitest-coverage';
export const VITEST_COVERAGE_REPORT =
  `${VITEST_COVERAGE_DIRECTORY}/coverage-final.json`;
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
] as const;

const MAX_REPORT_BYTES = 100 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const MAX_TIMEOUT_MS = 120 * 60_000;

type RunCommand = (
  command: string,
  args: string[],
  options: NonNullable<Parameters<typeof runProcess>[2]>,
) => Promise<ProcessResult>;

export type VitestCoverageFailure =
  | 'coverage_missing'
  | 'invalid_coverage'
  | 'invalid_test_results'
  | 'no_tests'
  | 'output_truncated'
  | 'test_failure'
  | 'timeout';

export type VitestCoverageRunResult = ProcessResult & {
  args: string[];
  command: 'vitest';
  coverageReportPath: string | null;
  failure: VitestCoverageFailure | null;
  failureMessage: string | null;
  lcovReportPath: string | null;
  passed: boolean;
  testCount: number | null;
  testResultsPath: string | null;
};

export type VitestCoverageOptions = {
  environment?: NodeJS.ProcessEnv;
  gid?: number;
  maxOutputBytes?: number;
  runCommand?: RunCommand;
  timeoutMs?: number;
  uid?: number;
};

function reportPath(root: string, relativePath: string): string {
  return path.join(root, ...relativePath.split('/'));
}

function removeStaleArtifacts(root: string): void {
  fs.rmSync(reportPath(root, VITEST_COVERAGE_DIRECTORY), {
    force: true,
    recursive: true,
  });
  fs.rmSync(reportPath(root, VITEST_RESULTS_REPORT), { force: true });
  fs.mkdirSync(reportPath(root, 'test-results'), { recursive: true });
}

function readFreshRegularFile(
  filePath: string,
  startedAtMs: number,
): string | null {
  try {
    const stat = fs.lstatSync(filePath);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size < 1 ||
      stat.size > MAX_REPORT_BYTES ||
      stat.mtimeMs + 1_000 < startedAtMs
    ) {
      return null;
    }
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function testCountFromReport(source: string | null): number | null {
  if (!source) return null;
  try {
    const value = JSON.parse(source) as Record<string, unknown>;
    const total = value.numTotalTests;
    return typeof total === 'number' &&
      Number.isSafeInteger(total) &&
      total >= 0
      ? total
      : null;
  } catch {
    return null;
  }
}

function isDetailedIstanbulCoverage(source: string | null): boolean {
  if (!source) return false;
  try {
    const value = JSON.parse(source) as Record<string, unknown>;
    return Object.values(value).some((candidate) => {
      if (
        !candidate ||
        typeof candidate !== 'object' ||
        Array.isArray(candidate)
      ) {
        return false;
      }
      const file = candidate as Record<string, unknown>;
      return (
        file.statementMap !== null &&
        typeof file.statementMap === 'object' &&
        !Array.isArray(file.statementMap) &&
        file.s !== null &&
        typeof file.s === 'object' &&
        !Array.isArray(file.s)
      );
    });
  } catch {
    return false;
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
        exclude: [...VITEST_UNIT_TEST_GLOBS],
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
  if (!coverageSource) {
    return {
      failure: 'coverage_missing',
      failureMessage:
        'Vitest did not produce the fixed detailed coverage report.',
    };
  }
  if (!isDetailedIstanbulCoverage(coverageSource)) {
    return {
      failure: 'invalid_coverage',
      failureMessage:
        'Vitest produced an invalid or empty detailed Istanbul coverage report.',
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

  removeStaleArtifacts(root);
  const configDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'playrunner-vitest-'),
  );
  const configPath = path.join(configDirectory, 'vitest.config.mjs');
  fs.writeFileSync(configPath, validatorConfig(root), { mode: 0o444 });
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
    fs.rmSync(configDirectory, { force: true, recursive: true });
  }

  const testResultsFile = reportPath(root, VITEST_RESULTS_REPORT);
  const coverageFile = reportPath(root, VITEST_COVERAGE_REPORT);
  const lcovFile = reportPath(root, VITEST_LCOV_REPORT);
  const testResultsSource = readFreshRegularFile(testResultsFile, startedAtMs);
  const coverageSource = readFreshRegularFile(coverageFile, startedAtMs);
  const lcovSource = readFreshRegularFile(lcovFile, startedAtMs);
  const testCount = testCountFromReport(testResultsSource);
  const failure = failureFor(processResult, testCount, coverageSource);

  return {
    ...processResult,
    args,
    command: 'vitest',
    coverageReportPath: coverageSource ? VITEST_COVERAGE_REPORT : null,
    ...failure,
    lcovReportPath: lcovSource ? VITEST_LCOV_REPORT : null,
    passed: failure.failure === null,
    testCount,
    testResultsPath: testResultsSource ? VITEST_RESULTS_REPORT : null,
  };
}
