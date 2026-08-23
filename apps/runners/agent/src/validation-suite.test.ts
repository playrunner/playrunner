import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateTestSuite } from './validation-suite';
import type { ExplicitUnitTestAnalysis, ValidationResult } from './validator';
import {
  runVitestCoverage,
  type VitestCoverageRunResult,
} from './vitest-validator';

function browserResult(passed = true): ValidationResult {
  return {
    artifacts: { traces: [] },
    attempt: 1,
    authoritative: true,
    completedAt: new Date().toISOString(),
    dimensions: {
      assertionQuality: { minimum: 100, observed: 100, passed: true },
      branchCoverage: { minimum: 0, observed: null, passed: true },
      changedLineCoverage: {
        applicable: false,
        minimum: 0,
        observed: null,
        passed: true,
      },
      lineCoverage: { minimum: 0, observed: null, passed: true },
      requirementCoverage: { minimum: 100, observed: 100, passed: true },
    },
    durationMs: 10,
    feedback: {
      items: [],
      summary: passed ? 'Validation passed.' : 'Validation failed.',
    },
    feedbackText: passed ? 'Validation passed.' : 'Validation failed.',
    passed,
    requirements: { covered: 1, items: [], total: 1 },
    schemaVersion: '1.0',
    startedAt: new Date().toISOString(),
    status: passed ? 'passed' : 'failed',
    testRun: {
      command: 'playwright test --retries=0',
      durationMs: 10,
      exitCode: passed ? 0 : 1,
      failedTests: [],
      passed,
      stderrTail: '',
      stdoutTail: '',
      timedOut: false,
    },
    testSummary: {
      files: 1,
      focused: 0,
      skipped: 0,
      tests: 1,
      testsWithMeaningfulAssertions: 1,
    },
    violations: [],
  };
}

function unitResult(passed: boolean): VitestCoverageRunResult {
  return {
    args: ['run'],
    branchCoverage: passed ? 85 : null,
    code: passed ? 0 : 1,
    command: 'vitest',
    coverageReportPath: passed
      ? 'test-results/vitest-coverage/coverage-final.json'
      : null,
    durationMs: 20,
    failure: passed ? null : 'no_tests',
    failureMessage: passed
      ? null
      : 'No explicit *.unit.test.* or *.unit.spec.* files were executed.',
    lcovReportPath: passed ? 'test-results/vitest-coverage/lcov.info' : null,
    lineCoverage: passed ? 90 : null,
    passed,
    signal: null,
    stderr: '',
    stdout: '',
    testCount: passed ? 2 : 0,
    testResultsPath: passed ? 'test-results/vitest-results.json' : null,
    timedOut: false,
  };
}

function unitAnalysis(
  testCount: number,
  overrides: Partial<ExplicitUnitTestAnalysis> = {},
): ExplicitUnitTestAnalysis {
  return {
    fileCount: testCount > 0 ? 1 : 0,
    fingerprint: testCount > 0 ? 'stable-unit-source' : 'empty-unit-source',
    focused: 0,
    skipped: 0,
    testCount,
    testsWithMeaningfulAssertions: testCount,
    violations: [],
    ...overrides,
  };
}

test('passes only when browser and independent unit validation both pass', async () => {
  let observedMinimum:
    | { branchCoverage: number; lineCoverage: number }
    | undefined;
  const result = await validateTestSuite(
    '/tmp',
    {
      minimum: { branchCoverage: 70, lineCoverage: 80 },
      unitCoverage: true,
    },
    {
      analyzeUnitTests: () => unitAnalysis(2),
      runUnitCoverage: async (_cwd, _timeout, minimum) => {
        observedMinimum = minimum;
        return unitResult(true);
      },
      validateBrowser: async () => browserResult(true),
    },
  );

  assert.equal(result.passed, true);
  assert.equal(result.unitTestRun?.passed, true);
  assert.equal(result.unitTestRun?.testCount, 2);
  assert.deepEqual(observedMinimum, {
    branchCoverage: 70,
    lineCoverage: 80,
  });
});

test('fails closed with actionable feedback when no unit tests execute', async () => {
  const result = await validateTestSuite(
    '/tmp',
    { unitCoverage: true },
    {
      analyzeUnitTests: () => unitAnalysis(0),
      runUnitCoverage: async () => unitResult(false),
      validateBrowser: async () => browserResult(true),
    },
  );

  assert.equal(result.passed, false);
  assert.equal(result.status, 'failed');
  assert.equal(result.feedback.items[0]?.code, 'unit_test_failure');
  assert.match(result.feedbackText, /\.unit\.test/);
  assert.equal(result.violations.at(-1)?.severity, 'error');
});

test('does not invoke Vitest when the supplemental layer is disabled', async () => {
  let unitRuns = 0;
  const result = await validateTestSuite(
    '/tmp',
    { unitCoverage: false },
    {
      runUnitCoverage: async () => {
        unitRuns += 1;
        return unitResult(true);
      },
      validateBrowser: async () => browserResult(true),
    },
  );

  assert.equal(result.passed, true);
  assert.equal(result.unitTestRun, undefined);
  assert.equal(unitRuns, 0);
});

test('caps the unit command by the configured validation timeout', async () => {
  let observedTimeout = 0;
  await validateTestSuite(
    '/tmp',
    { unitCoverage: true, validationTimeoutMinutes: 1 },
    {
      analyzeUnitTests: () => unitAnalysis(2),
      runUnitCoverage: async (_cwd, timeout) => {
        observedTimeout = timeout;
        return unitResult(true);
      },
      timeoutMs: 10 * 60_000,
      validateBrowser: async () => browserResult(true),
    },
  );

  assert.ok(observedTimeout > 0);
  assert.ok(observedTimeout <= 60_000);
});

test('blocks a green Vitest run when trivial unit assertions are detected', async () => {
  const result = await validateTestSuite(
    '/tmp',
    { unitCoverage: true },
    {
      analyzeUnitTests: () =>
        unitAnalysis(2, {
          testsWithMeaningfulAssertions: 1,
          violations: [
            {
              code: 'trivial_assertion',
              column: 3,
              file: 'src/example.unit.test.ts',
              line: 8,
              message: 'The assertion proves only a literal value.',
              priority: 'high',
              remediation: 'Assert production behavior.',
              severity: 'error',
            },
          ],
        }),
      runUnitCoverage: async () => unitResult(true),
      validateBrowser: async () => browserResult(true),
    },
  );

  assert.equal(result.passed, false);
  assert.equal(result.unitTestRun?.passed, false);
  assert.equal(result.unitTestRun?.failure, 'static_quality_gate');
  assert.equal(result.unitTestRun?.testsWithMeaningfulAssertions, 1);
  assert.deepEqual(
    result.feedback.items.slice(0, 2).map(({ code }) => code),
    ['trivial_assertion', 'unit_assertion_quality'],
  );
  assert.equal(
    result.feedback.items[0]?.location,
    'src/example.unit.test.ts:8:3',
  );
});

test('blocks a green Vitest run when executed and analyzed test counts differ', async () => {
  const result = await validateTestSuite(
    '/tmp',
    { unitCoverage: true },
    {
      analyzeUnitTests: () => unitAnalysis(1),
      runUnitCoverage: async () => unitResult(true),
      validateBrowser: async () => browserResult(true),
    },
  );

  assert.equal(result.passed, false);
  assert.equal(result.unitTestRun?.analyzedTests, 1);
  assert.equal(result.unitTestRun?.testCount, 2);
  assert.equal(result.feedback.items[0]?.code, 'unit_test_execution_mismatch');
});

test('blocks validation when unit sources change during execution', async () => {
  let analysisRuns = 0;
  const result = await validateTestSuite(
    '/tmp',
    { unitCoverage: true },
    {
      analyzeUnitTests: () => {
        analysisRuns += 1;
        return unitAnalysis(2, {
          fingerprint: analysisRuns === 1 ? 'before' : 'after',
        });
      },
      runUnitCoverage: async () => unitResult(true),
      validateBrowser: async () => browserResult(true),
    },
  );

  assert.equal(result.passed, false);
  assert.equal(result.unitTestRun?.sourceStable, false);
  assert.equal(result.feedback.items[0]?.code, 'unit_test_source_changed');
});

test('reconciles real Vitest execution with the audited explicit unit source', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'playrunner-unit-suite-'));
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.symlinkSync(
      path.join(process.cwd(), 'node_modules'),
      path.join(root, 'node_modules'),
      'dir',
    );
    fs.writeFileSync(
      path.join(root, 'src', 'math.ts'),
      'export const double = (value: number) => value * 2;\n',
    );
    fs.writeFileSync(
      path.join(root, 'src', 'math.unit.test.ts'),
      [
        "import { expect, test } from 'vitest';",
        "import { double } from './math';",
        "test('doubles input', () => expect(double(2)).toBe(4));",
        '',
      ].join('\n'),
    );

    const result = await validateTestSuite(
      root,
      {
        minimum: { branchCoverage: 100, lineCoverage: 100 },
        unitCoverage: true,
        validationTimeoutMinutes: 1,
      },
      {
        runUnitCoverage: (cwd, timeoutMs, minimum) =>
          runVitestCoverage(cwd, {
            environment: {
              ...process.env,
              PATH: `${path.join(process.cwd(), 'node_modules', '.bin')}:${process.env.PATH || ''}`,
            },
            minimumBranchCoverage: minimum.branchCoverage,
            minimumLineCoverage: minimum.lineCoverage,
            timeoutMs,
          }),
        validateBrowser: async () => browserResult(true),
      },
    );

    assert.equal(
      result.passed,
      true,
      result.feedbackText || result.unitTestRun?.stderrTail,
    );
    assert.equal(result.unitTestRun?.testCount, 1);
    assert.equal(result.unitTestRun?.analyzedTests, 1);
    assert.equal(result.unitTestRun?.testsWithMeaningfulAssertions, 1);
    assert.equal(result.unitTestRun?.sourceStable, true);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});
