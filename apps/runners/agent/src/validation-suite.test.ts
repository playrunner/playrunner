import assert from 'node:assert/strict';
import test from 'node:test';
import { validateTestSuite } from './validation-suite';
import type { ValidationResult } from './validator';
import type { VitestCoverageRunResult } from './vitest-validator';

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
    lcovReportPath: passed
      ? 'test-results/vitest-coverage/lcov.info'
      : null,
    passed,
    signal: null,
    stderr: '',
    stdout: '',
    testCount: passed ? 2 : 0,
    testResultsPath: passed ? 'test-results/vitest-results.json' : null,
    timedOut: false,
  };
}

test('passes only when browser and independent unit validation both pass', async () => {
  const result = await validateTestSuite(
    '/tmp',
    { unitCoverage: true },
    {
      runUnitCoverage: async () => unitResult(true),
      validateBrowser: async () => browserResult(true),
    },
  );

  assert.equal(result.passed, true);
  assert.equal(result.unitTestRun?.passed, true);
  assert.equal(result.unitTestRun?.testCount, 2);
});

test('fails closed with actionable feedback when no unit tests execute', async () => {
  const result = await validateTestSuite(
    '/tmp',
    { unitCoverage: true },
    {
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
