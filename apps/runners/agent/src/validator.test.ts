import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ProcessResult } from './process';
import {
  DEFAULT_FAIL_ON,
  VALIDATOR_LIMITS,
  validatePlaywrightTests,
  type ValidationResult,
} from './validator';
import type { ChangeManifest } from './repository';

const ZERO_MINIMUMS = {
  assertionQuality: 0,
  branchCoverage: 0,
  changedLineCoverage: 0,
  lineCoverage: 0,
  requirementCoverage: 0,
};

function createProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'validator-test-'));
}

function writeProjectFile(
  directory: string,
  relativePath: string,
  contents: string,
): string {
  const file = path.join(directory, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}

function successfulProcess(
  overrides: Partial<ProcessResult> = {},
): ProcessResult {
  return {
    code: 0,
    durationMs: 10,
    signal: null,
    stderr: '',
    stdout: '',
    timedOut: false,
    ...overrides,
  };
}

function meaningfulTest(title = 'renders the dashboard'): string {
  return [
    "import { expect, test } from '@playwright/test';",
    '',
    `test('${title}', async ({ page }) => {`,
    "  await expect(page.getByRole('heading')).toHaveText('Dashboard');",
    '});',
    '',
  ].join('\n');
}

function writePlaywrightJsonReport(
  directory: string,
  tests: Array<{
    column?: number;
    expectedStatus?: string;
    file?: string;
    line?: number;
    outcome?: 'expected' | 'flaky' | 'skipped' | 'unexpected';
    project?: string;
    resultStatus?: string;
    title?: string;
  }> = [{}],
  outputPath = path.join(
    directory,
    'test-results/.playrunner-validation-results.json',
  ),
): string {
  const normalized = tests.map((candidate, index) => {
    const outcome = candidate.outcome || 'expected';
    const expectedStatus = candidate.expectedStatus || 'passed';
    const resultStatus =
      candidate.resultStatus || (outcome === 'skipped' ? 'skipped' : 'passed');
    return {
      column: candidate.column || 1,
      expectedStatus,
      file: candidate.file || 'tests/dashboard.spec.ts',
      line: candidate.line || 3,
      outcome,
      project: candidate.project ?? 'chromium',
      resultStatus,
      title: candidate.title || 'renders the dashboard',
      id: `test-${index + 1}`,
    };
  });
  const stats = { expected: 0, flaky: 0, skipped: 0, unexpected: 0 };
  for (const candidate of normalized) stats[candidate.outcome] += 1;
  const report = {
    config: { projects: [], rootDir: directory },
    errors: [],
    stats: { ...stats, duration: 10, startTime: new Date(0).toISOString() },
    suites: [
      {
        column: 0,
        file: normalized[0]?.file || 'tests/dashboard.spec.ts',
        line: 0,
        specs: normalized.map((candidate) => ({
          column: candidate.column,
          file: candidate.file,
          id: candidate.id,
          line: candidate.line,
          ok:
            candidate.outcome === 'expected' &&
            candidate.expectedStatus === 'passed' &&
            candidate.resultStatus === 'passed',
          tags: [],
          tests: [
            {
              annotations: [],
              expectedStatus: candidate.expectedStatus,
              projectId: candidate.project,
              projectName: candidate.project,
              results: [
                {
                  annotations: [],
                  attachments: [],
                  duration: 10,
                  errors: [],
                  retry: 0,
                  startTime: new Date(0).toISOString(),
                  status: candidate.resultStatus,
                  stderr: [],
                  stdout: [],
                  workerIndex: 0,
                },
              ],
              status: candidate.outcome,
              timeout: 30_000,
            },
          ],
          title: candidate.title,
        })),
        title: 'tests',
      },
    ],
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report));
  return outputPath;
}

function istanbulFile(options: {
  coveredBranches?: number;
  coveredLines: number;
  startLine?: number;
  totalBranches?: number;
  totalLines: number;
}) {
  const startLine = options.startLine || 1;
  const statementIds = Array.from({ length: options.totalLines }, (_, index) =>
    String(index),
  );
  return {
    ...(options.totalBranches === undefined
      ? {}
      : {
          b: {
            0: Array.from({ length: options.totalBranches }, (_, index) =>
              index < (options.coveredBranches || 0) ? 1 : 0,
            ),
          },
        }),
    s: Object.fromEntries(
      statementIds.map((id, index) => [
        id,
        index < options.coveredLines ? 1 : 0,
      ]),
    ),
    statementMap: Object.fromEntries(
      statementIds.map((id, index) => [
        id,
        { start: { line: startLine + index } },
      ]),
    ),
  };
}

function productionChangeManifest(
  files: Array<{
    changedLines: Array<{ end: number; start: number }>;
    path: string;
  }>,
): ChangeManifest {
  const changedLines = files.reduce(
    (total, file) =>
      total +
      file.changedLines.reduce(
        (fileTotal, range) => fileTotal + range.end - range.start + 1,
        0,
      ),
    0,
  );
  return {
    context: {
      baseRef: 'main',
      baseSha: '1'.repeat(40),
      eventType: 'push',
      headRef: 'feature/coverage',
      headSha: '2'.repeat(40),
      repository: 'example/project',
    },
    files: files.map((file) => ({
      binary: false,
      changedLineCount: file.changedLines.reduce(
        (total, range) => total + range.end - range.start + 1,
        0,
      ),
      changedLines: file.changedLines,
      classification: 'production',
      path: file.path,
      status: 'modified',
    })),
    schemaVersion: '1.0',
    summary: {
      changedFiles: files.length,
      changedLines,
      configChangedLines: 0,
      configFiles: 0,
      productionChangedLines: changedLines,
      productionFiles: files.length,
      testChangedLines: 0,
      testFiles: 0,
    },
  };
}

function findViolation(
  result: ValidationResult,
  code: string,
  line?: number,
): ValidationResult['violations'][number] {
  const violation = result.violations.find(
    (candidate) =>
      candidate.code === code &&
      (line === undefined || candidate.line === line),
  );
  if (!violation) {
    assert.fail(
      `Expected ${code}${line === undefined ? '' : ` on line ${line}`}. Found: ${result.violations
        .map((candidate) => `${candidate.code}@${candidate.line ?? '-'}`)
        .join(', ')}`,
    );
  }
  return violation;
}

test('authoritative validation removes stale artifacts and labels fresh detailed coverage as repository-reported', async () => {
  const directory = createProject();
  try {
    writeProjectFile(
      directory,
      'tests/dashboard.spec.ts',
      meaningfulTest('REQ-DASHBOARD renders the dashboard'),
    );
    const coveragePath = writeProjectFile(
      directory,
      'coverage/coverage-final.json',
      JSON.stringify({
        'src/stale.ts': istanbulFile({
          coveredBranches: 0,
          coveredLines: 0,
          totalBranches: 1,
          totalLines: 1,
        }),
      }),
    );
    const staleReport = writeProjectFile(
      directory,
      'playwright-report/stale.html',
      'stale',
    );
    const staleTrace = writeProjectFile(
      directory,
      'test-results/stale/trace.zip',
      'stale',
    );
    let invoked = false;

    const result = await validatePlaywrightTests(
      directory,
      {
        coverageSummaryPaths: ['coverage/coverage-final.json'],
        failOn: [],
        minimum: {
          assertionQuality: 100,
          branchCoverage: 80,
          lineCoverage: 90,
          requirementCoverage: 100,
        },
        requirements: 'REQ-DASHBOARD: Show the dashboard heading',
        validationCommand:
          'npm run test:coverage -- --reporter=line --retries=0',
        validationTimeoutMinutes: 2,
      },
      {
        attempt: 3,
        authoritative: true,
        runCommand: async (command, cwd, timeoutMs, environment) => {
          invoked = true;
          assert.equal(
            command,
            `playwright test --retries=0 --config=${path.join(directory, '.playrunner-validator.config.ts')}`,
          );
          assert.equal(cwd, directory);
          assert.equal(timeoutMs, 120_000);
          assert.equal(
            environment?.PLAYWRIGHT_JSON_OUTPUT_FILE,
            path.join(
              directory,
              'test-results/.playrunner-validation-results.json',
            ),
          );
          assert.equal(fs.existsSync(coveragePath), false);
          assert.equal(fs.existsSync(staleReport), false);
          assert.equal(fs.existsSync(staleTrace), false);

          writeProjectFile(
            directory,
            'coverage/coverage-final.json',
            JSON.stringify({
              'src/dashboard.ts': istanbulFile({
                coveredBranches: 22,
                coveredLines: 24,
                totalBranches: 25,
                totalLines: 25,
              }),
            }),
          );
          writeProjectFile(directory, 'playwright-report/index.html', 'fresh');
          writeProjectFile(
            directory,
            'test-results/dashboard/trace.zip',
            'fresh',
          );
          writePlaywrightJsonReport(directory, [
            {
              file: 'tests/dashboard.spec.ts',
              line: 3,
              title: 'REQ-DASHBOARD renders the dashboard',
            },
          ]);
          return successfulProcess({ durationMs: 47, stdout: '1 passed\n' });
        },
      },
    );

    assert.equal(invoked, true);
    assert.equal(result.passed, true);
    assert.equal(result.authoritative, true);
    assert.equal(result.attempt, 3);
    assert.equal(result.dimensions.lineCoverage.observed, 96);
    assert.equal(result.dimensions.branchCoverage.observed, 88);
    assert.equal(result.dimensions.assertionQuality.observed, 100);
    assert.equal(result.dimensions.requirementCoverage.observed, 100);
    assert.deepEqual(result.coverageEvidence, {
      detailed: true,
      fresh: true,
      provenance: 'repository_reported_untrusted',
      reviewRequired: true,
      sourcePath: 'coverage/coverage-final.json',
    });
    assert.deepEqual(result.artifacts, {
      coverage: 'coverage/coverage-final.json',
      playwrightReport: 'playwright-report',
      testResults: 'test-results',
      traces: ['test-results/dashboard/trace.zip'],
    });
    assert.deepEqual(result.testRun, {
      command: 'playwright test --reporter=line --retries=0',
      durationMs: 47,
      exitCode: 0,
      failedTests: [],
      passed: true,
      stderrTail: '',
      stdoutTail: '1 passed\n',
      timedOut: false,
    });
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('authoritative reporter config preserves repository reporters and removes overrides', async () => {
  const directory = createProject();
  const wrapperPath = path.join(directory, '.playrunner-validator.config.ts');
  try {
    writeProjectFile(directory, 'tests/reporters.spec.ts', meaningfulTest());
    writeProjectFile(
      directory,
      'playwright.config.ts',
      [
        "import { defineConfig } from '@playwright/test';",
        'export default defineConfig({',
        "  reporter: [['@bgotink/playwright-coverage', { resultDir: 'coverage' }], ['html']],",
        "  testDir: './tests',",
        '});',
        '',
      ].join('\n'),
    );

    const result = await validatePlaywrightTests(
      directory,
      {
        failOn: [],
        minimum: ZERO_MINIMUMS,
        validationCommand:
          'PLAYWRIGHT_JSON_OUTPUT_FILE=untrusted.json CI=true playwright test --config playwright.config.ts --reporter html --retries=0',
      },
      {
        runCommand: async (command, _cwd, _timeout, environment) => {
          assert.equal(
            command,
            `CI=true playwright test --retries=0 --config=${wrapperPath}`,
          );
          assert.equal(
            environment?.PLAYWRIGHT_JSON_OUTPUT_FILE,
            path.join(
              directory,
              'test-results/.playrunner-validation-results.json',
            ),
          );
          const wrapper = fs.readFileSync(wrapperPath, 'utf8');
          assert.match(
            wrapper,
            /import importedConfig from "\.\/playwright\.config\.ts"/,
          );
          assert.match(
            wrapper,
            /const configuredReporter = baseConfig\.reporter/,
          );
          assert.match(wrapper, /reporters\.push\(\['line'\]\)/);
          assert.match(wrapper, /reporters\.push\(\['json'\]\)/);
          assert.equal(fs.lstatSync(wrapperPath).mode & 0o222, 0);
          writePlaywrightJsonReport(
            directory,
            [{ file: 'tests/reporters.spec.ts' }],
            environment?.PLAYWRIGHT_JSON_OUTPUT_FILE,
          );
          return successfulProcess();
        },
      },
    );

    assert.equal(result.passed, true);
    assert.equal(fs.existsSync(wrapperPath), false);
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('AST analysis reports quality rules with precise source locations', async () => {
  const directory = createProject();
  try {
    writeProjectFile(
      directory,
      'tests/quality.spec.ts',
      [
        "import { expect, test } from '@playwright/test';",
        '',
        'test.configure({ retries: 2 });',
        "test.only('focused literal assertion', async ({ page }, testInfo) => {",
        '  await page.waitForTimeout(250);',
        "  await page.locator('#submit').click();",
        '  if (testInfo.retry() > 0) {}',
        '  expect(true).toBeTruthy();',
        '});',
        '',
        "test.skip('skipped behavior', async () => {});",
        "test('missing assertion', async ({ page }) => { await page.getByText('ready').click(); });",
        '',
        "const externalBody = async () => { expect('value').toBe('value'); };",
        "test('external callback', externalBody);",
        '',
      ].join('\n'),
    );

    const result = await validatePlaywrightTests(directory, {
      failOn: [
        'focused_test',
        'hardcoded_wait',
        'retry_dependence',
        'skipped_test',
        'trivial_assertion',
        'unresolved_test_body',
        'weak_selector',
        'zero_assertion_test',
      ],
      minimum: ZERO_MINIMUMS,
      runTests: false,
    });

    assert.equal(result.passed, false);
    assert.deepEqual(result.testSummary, {
      files: 1,
      focused: 1,
      skipped: 1,
      tests: 4,
      testsWithMeaningfulAssertions: 0,
    });
    assert.deepEqual(
      {
        column: findViolation(result, 'focused_test', 4).column,
        file: findViolation(result, 'focused_test', 4).file,
        line: findViolation(result, 'focused_test', 4).line,
      },
      { column: 1, file: 'tests/quality.spec.ts', line: 4 },
    );
    assert.equal(findViolation(result, 'retry_dependence', 3).column, 1);
    assert.equal(findViolation(result, 'retry_dependence', 7).column, 7);
    assert.equal(findViolation(result, 'hardcoded_wait', 5).column, 9);
    assert.equal(findViolation(result, 'weak_selector', 6).column, 9);
    assert.equal(findViolation(result, 'trivial_assertion', 8).column, 3);
    assert.equal(findViolation(result, 'skipped_test', 11).column, 1);
    assert.equal(findViolation(result, 'zero_assertion_test', 12).column, 1);
    assert.equal(findViolation(result, 'unresolved_test_body', 15).column, 1);
    assert.ok(
      result.feedback.items.some(
        (item) =>
          item.code === 'hardcoded_wait' &&
          item.location === 'tests/quality.spec.ts:5:9',
      ),
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('only invoked expect matchers count as assertions while modifiers and custom matchers remain valid', async () => {
  const directory = createProject();
  try {
    writeProjectFile(
      directory,
      'tests/expect-contract.spec.ts',
      [
        "import { expect, test } from '@playwright/test';",
        '',
        "test('bare expect', async ({ page }) => { expect(page); });",
        "test('expect configuration', async () => { expect.configure({ timeout: 100 }); });",
        "test('soft custom matcher', async ({ page }) => { await expect.soft(page).not.toSatisfyCustomMatcher(); });",
        "test('poll custom matcher', async ({ page }) => { await expect.poll(() => page.url()).toMatchCustomUrl(); });",
        "test('promise modifier', async () => { await expect(Promise.resolve('ok')).resolves.toMatchCustomValue(); });",
        "test('asymmetric expected value', async ({ page }) => { await expect(page.evaluate(() => ({ ready: true }))).toEqual(expect.objectContaining({ ready: true })); });",
        '',
      ].join('\n'),
    );

    const result = await validatePlaywrightTests(directory, {
      failOn: ['zero_assertion_test'],
      minimum: ZERO_MINIMUMS,
      runTests: false,
    });

    assert.equal(result.passed, false);
    assert.deepEqual(result.testSummary, {
      files: 1,
      focused: 0,
      skipped: 0,
      tests: 6,
      testsWithMeaningfulAssertions: 4,
    });
    assert.deepEqual(
      result.violations
        .filter(({ code }) => code === 'zero_assertion_test')
        .map(({ line }) => line),
      [3, 4],
    );
    assert.equal(
      result.violations.some(({ code }) => code === 'trivial_assertion'),
      false,
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('test.fail is blocked and cannot provide assertion or requirement evidence', async () => {
  const directory = createProject();
  try {
    writeProjectFile(
      directory,
      'tests/expected-failure.spec.ts',
      [
        "import { expect, test } from '@playwright/test';",
        '',
        "test('REQ-FAIL expected failure', async ({ page }) => {",
        '  test.fail();',
        "  await expect(page.getByRole('status')).toHaveText('Broken');",
        '});',
        '',
        "test('REQ-ACTIVE working behavior', async ({ page }) => {",
        "  await expect(page.getByRole('status')).toHaveText('Ready');",
        '});',
        '',
      ].join('\n'),
    );

    const result = await validatePlaywrightTests(directory, {
      failOn: ['expected_failure_test'],
      minimum: ZERO_MINIMUMS,
      requirements: [
        'REQ-FAIL: Expected failures are not valid evidence',
        'REQ-ACTIVE: Working behavior is valid evidence',
      ].join('\n'),
      runTests: false,
    });

    assert.ok(DEFAULT_FAIL_ON.includes('expected_failure_test'));
    assert.equal(result.passed, false);
    assert.equal(findViolation(result, 'expected_failure_test', 4).column, 3);
    assert.deepEqual(result.testSummary, {
      files: 1,
      focused: 0,
      skipped: 0,
      tests: 2,
      testsWithMeaningfulAssertions: 1,
    });
    assert.equal(result.dimensions.assertionQuality.observed, 50);
    const byId = new Map(
      result.requirements.items.map((requirement) => [
        requirement.id,
        requirement,
      ]),
    );
    assert.deepEqual(byId.get('REQ-FAIL')?.evidence, []);
    assert.equal(byId.get('REQ-FAIL')?.passed, false);
    assert.equal(byId.get('REQ-ACTIVE')?.passed, true);
    assert.deepEqual(
      result.feedback.items.map(({ code }) => code),
      ['expected_failure_test'],
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('requirement IDs match complete tokens instead of identifier prefixes', async () => {
  const directory = createProject();
  try {
    writeProjectFile(
      directory,
      'tests/requirement-id.spec.ts',
      meaningfulTest('REQ-10 renders the dashboard'),
    );

    const result = await validatePlaywrightTests(directory, {
      failOn: ['skipped_requirement'],
      minimum: ZERO_MINIMUMS,
      requirements: [
        'REQ-1: Short identifier must not match a longer identifier',
        'REQ-10: Longer identifier has exact evidence',
      ].join('\n'),
      runTests: false,
    });

    assert.equal(result.passed, false);
    assert.equal(result.requirements.covered, 1);
    const byId = new Map(
      result.requirements.items.map((requirement) => [
        requirement.id,
        requirement,
      ]),
    );
    assert.equal(byId.get('REQ-1')?.passed, false);
    assert.deepEqual(byId.get('REQ-1')?.evidence, []);
    assert.equal(byId.get('REQ-10')?.passed, true);
    assert.deepEqual(
      result.feedback.items.map(({ code }) => code),
      ['skipped_requirement'],
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('malformed or one-character requirement IDs fail closed', async () => {
  const directory = createProject();
  try {
    writeProjectFile(
      directory,
      'tests/requirements.spec.ts',
      meaningfulTest('valid behavior'),
    );
    const result = await validatePlaywrightTests(directory, {
      minimum: ZERO_MINIMUMS,
      requirements: ': missing identifier\nA: identifier is too short',
      runTests: false,
    });

    assert.equal(result.passed, false);
    assert.equal(result.requirements.total, 0);
    assert.equal(result.requirements.configuredTotal, 2);
    assert.equal(result.dimensions.requirementCoverage.observed, 0);
    assert.equal(
      result.violations.filter(
        ({ code }) => code === 'invalid_validator_configuration',
      ).length,
      2,
    );
    assert.match(
      findViolation(result, 'invalid_validator_configuration').message,
      /stable ID of at least two characters/,
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('oversized and over-count requirement configuration fails closed with bounded output', async () => {
  const directory = createProject();
  try {
    writeProjectFile(
      directory,
      'tests/config-bounds.spec.ts',
      meaningfulTest(),
    );

    const oversized = await validatePlaywrightTests(directory, {
      failOn: [],
      minimum: ZERO_MINIMUMS,
      requirements: 'R'.repeat(10 * 1024 * 1024),
      runTests: false,
    });

    assert.equal(oversized.passed, false);
    assert.match(
      findViolation(oversized, 'invalid_validator_configuration').message,
      new RegExp(`limit is ${VALIDATOR_LIMITS.requirementSourceBytes}`),
    );
    assert.equal(oversized.requirements.items.length, 0);
    assert.equal(oversized.requirements.truncated, true);
    assert.ok(
      Buffer.byteLength(JSON.stringify(oversized, null, 2), 'utf8') <
        VALIDATOR_LIMITS.inlineResultBytes,
    );

    const requirementLines = Array.from(
      { length: VALIDATOR_LIMITS.requirementCount + 1 },
      (_, index) => `REQ-${index}: Requirement ${index}`,
    ).join('\n');
    const overCount = await validatePlaywrightTests(directory, {
      failOn: [],
      minimum: ZERO_MINIMUMS,
      requirements: requirementLines,
      runTests: false,
    });

    assert.equal(overCount.passed, false);
    assert.equal(
      overCount.requirements.configuredTotal,
      VALIDATOR_LIMITS.requirementCount + 1,
    );
    assert.equal(
      overCount.requirements.items.length,
      VALIDATOR_LIMITS.requirementCount,
    );
    assert.equal(overCount.requirements.reported, 100);
    assert.equal(overCount.requirements.total, 100);
    assert.equal(overCount.requirements.truncated, true);
    assert.match(
      findViolation(overCount, 'invalid_validator_configuration').message,
      /contains 101 entries/,
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('requirement evidence, descriptions, and test titles are bounded with counts', async () => {
  const directory = createProject();
  try {
    writeProjectFile(
      directory,
      'tests/evidence-bounds.spec.ts',
      [
        "import { expect, test } from '@playwright/test';",
        '',
        ...Array.from({ length: 12 }, (_, index) =>
          [
            `test('REQ-EVIDENCE ${'T'.repeat(500)} ${index}', async ({ page }) => {`,
            "  await expect(page.getByRole('status')).toHaveText('Ready');",
            '});',
          ].join('\n'),
        ),
        '',
      ].join('\n'),
    );

    const result = await validatePlaywrightTests(directory, {
      failOn: [],
      minimum: ZERO_MINIMUMS,
      requirements: `REQ-EVIDENCE: ${'D'.repeat(2_000)}`,
      runTests: false,
    });

    assert.equal(result.passed, false);
    findViolation(result, 'invalid_validator_configuration');
    const requirement = result.requirements.items[0];
    assert.ok(requirement);
    assert.equal(requirement.passed, true);
    assert.equal(requirement.evidence.length, 10);
    assert.equal(requirement.evidenceTotal, 12);
    assert.equal(requirement.evidenceTruncated, true);
    assert.ok(
      Buffer.byteLength(requirement.description, 'utf8') <=
        VALIDATOR_LIMITS.requirementDescriptionBytes,
    );
    for (const evidence of requirement.evidence) {
      assert.ok(
        Buffer.byteLength(evidence.test, 'utf8') <=
          VALIDATOR_LIMITS.testTitleBytes,
      );
    }
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('reported violations and feedback are bounded while retaining total counts', async () => {
  const directory = createProject();
  try {
    writeProjectFile(
      directory,
      'tests/report-bounds.spec.ts',
      [
        "import { expect, test } from '@playwright/test';",
        '',
        "test('bounded report', async ({ page }) => {",
        `  await page.locator('#${'S'.repeat(5_000)}').click();`,
        ...Array.from(
          { length: 1_105 },
          (_, index) => `  await page.waitForTimeout(${index + 1});`,
        ),
        "  await expect(page.getByRole('status')).toHaveText('Ready');",
        '});',
        '',
      ].join('\n'),
    );

    const result = await validatePlaywrightTests(directory, {
      failOn: ['hardcoded_wait', 'weak_selector'],
      minimum: ZERO_MINIMUMS,
      runTests: false,
    });

    assert.equal(result.passed, false);
    assert.deepEqual(result.violationSummary, {
      reported: VALIDATOR_LIMITS.violations,
      total: 1_106,
      truncated: true,
    });
    assert.equal(result.violations.length, VALIDATOR_LIMITS.violations);
    assert.equal(result.feedback.total, 1_106);
    assert.equal(result.feedback.reported, VALIDATOR_LIMITS.feedbackItems);
    assert.equal(result.feedback.items.length, VALIDATOR_LIMITS.feedbackItems);
    assert.equal(result.feedback.truncated, true);
    assert.ok(
      Buffer.byteLength(result.feedbackText, 'utf8') <=
        VALIDATOR_LIMITS.feedbackTextBytes,
    );
    assert.ok(
      Buffer.byteLength(
        findViolation(result, 'weak_selector').message,
        'utf8',
      ) <= VALIDATOR_LIMITS.violationMessageBytes,
    );
    assert.ok(
      Buffer.byteLength(JSON.stringify(result, null, 2), 'utf8') <
        VALIDATOR_LIMITS.inlineResultBytes,
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('describe skip and fixme mark nested tests skipped without classifying the suites as focused', async () => {
  const directory = createProject();
  try {
    writeProjectFile(
      directory,
      'tests/suites.spec.ts',
      [
        "import { expect, test } from '@playwright/test';",
        '',
        "test.describe.skip('disabled suite', () => {",
        "  test('REQ-SKIPPED disabled behavior', async () => {});",
        '});',
        '',
        "test.describe.fixme('unfinished suite', () => {",
        "  test('REQ-FIXME unfinished behavior', async () => {});",
        '});',
        '',
        "test.describe.only('focused suite', () => {",
        "  test('focused behavior', async ({ page }) => {",
        "    await expect(page.getByRole('status')).toHaveText('Ready');",
        '  });',
        '});',
        '',
        "test('REQ-ACTIVE active behavior', async ({ page }) => {",
        "  await expect(page.getByRole('status')).toHaveText('Ready');",
        '});',
        '',
      ].join('\n'),
    );

    const result = await validatePlaywrightTests(directory, {
      failOn: [],
      minimum: { ...ZERO_MINIMUMS, assertionQuality: 100 },
      requirements: [
        'REQ-SKIPPED: Disabled behavior is not evidence',
        'REQ-FIXME: Unfinished behavior is not evidence',
        'REQ-ACTIVE: Active behavior is evidence',
      ].join('\n'),
      runTests: false,
    });

    assert.equal(result.passed, true);
    assert.deepEqual(result.testSummary, {
      files: 1,
      focused: 1,
      skipped: 2,
      tests: 4,
      testsWithMeaningfulAssertions: 2,
    });
    assert.deepEqual(result.dimensions.assertionQuality, {
      minimum: 100,
      observed: 100,
      passed: true,
    });
    assert.deepEqual(
      result.violations
        .filter(({ code }) => code === 'focused_test')
        .map(({ line }) => line),
      [11],
    );
    assert.deepEqual(
      result.violations
        .filter(({ code }) => code === 'skipped_test')
        .map(({ line }) => line),
      [3, 7],
    );
    assert.equal(
      result.violations.some(({ code }) => code === 'zero_assertion_test'),
      false,
    );
    const requirements = new Map(
      result.requirements.items.map((requirement) => [
        requirement.id,
        requirement,
      ]),
    );
    assert.equal(requirements.get('REQ-SKIPPED')?.passed, false);
    assert.equal(requirements.get('REQ-FIXME')?.passed, false);
    assert.equal(requirements.get('REQ-ACTIVE')?.passed, true);
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('fails closed when a candidate test file exceeds the per-file analysis bound', async () => {
  const directory = createProject();
  try {
    const oversized = writeProjectFile(
      directory,
      'tests/oversized.spec.ts',
      meaningfulTest(),
    );
    fs.truncateSync(oversized, 2 * 1024 * 1024 + 1);

    const result = await validatePlaywrightTests(directory, {
      failOn: [],
      minimum: ZERO_MINIMUMS,
      runTests: false,
    });

    assert.equal(result.passed, false);
    assert.equal(result.testSummary.files, 0);
    const violation = findViolation(result, 'analysis_incomplete');
    assert.equal(violation.file, 'tests/oversized.spec.ts');
    assert.match(violation.message, /per-file analysis limit/);
    assert.deepEqual(
      result.feedback.items.map(({ code }) => code),
      ['analysis_incomplete'],
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('scopes discovery to a literal testDir and ignores unrelated global Jest tests', async () => {
  const directory = createProject();
  try {
    writeProjectFile(
      directory,
      'playwright.config.ts',
      "import { defineConfig } from '@playwright/test';\nexport default defineConfig({ testDir: './e2e' });\n",
    );
    writeProjectFile(
      directory,
      'e2e/checkout-flow.ts',
      meaningfulTest('custom testDir behavior'),
    );
    writeProjectFile(
      directory,
      'tests/unit/checkout.test.ts',
      [
        "test.skip('unit behavior managed by Jest globals', () => {",
        '  expect(true).toBe(true);',
        '});',
        '',
      ].join('\n'),
    );

    const result = await validatePlaywrightTests(directory, {
      failOn: ['skipped_test'],
      minimum: { ...ZERO_MINIMUMS, assertionQuality: 100 },
      runTests: false,
    });

    assert.equal(result.passed, true);
    assert.equal(result.testSummary.files, 1);
    assert.equal(result.testSummary.tests, 1);
    assert.equal(result.testSummary.skipped, 0);
    assert.equal(
      result.violations.some(({ code }) => code === 'skipped_test'),
      false,
    );
    assert.equal(result.dimensions.assertionQuality.observed, 100);
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('fails closed when a literal testDir resolves through a symbolic link', async () => {
  const directory = createProject();
  const outside = createProject();
  try {
    writeProjectFile(
      directory,
      'playwright.config.ts',
      "import { defineConfig } from '@playwright/test';\nexport default defineConfig({ testDir: './e2e' });\n",
    );
    writeProjectFile(outside, 'outside.spec.ts', meaningfulTest());
    fs.symlinkSync(outside, path.join(directory, 'e2e'));

    const result = await validatePlaywrightTests(directory, {
      failOn: [],
      minimum: ZERO_MINIMUMS,
      runTests: false,
    });

    assert.equal(result.passed, false);
    assert.equal(result.testSummary.files, 0);
    assert.match(
      findViolation(result, 'analysis_incomplete').message,
      /not a real directory inside the validation workspace/,
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
    fs.rmSync(outside, { force: true, recursive: true });
  }
});

test('fails closed when test discovery exceeds its directory depth bound', async () => {
  const directory = createProject();
  try {
    const nested = Array.from({ length: 65 }, (_, index) => `level-${index}`);
    writeProjectFile(
      directory,
      path.join(...nested, 'deep.spec.ts'),
      meaningfulTest(),
    );

    const result = await validatePlaywrightTests(directory, {
      failOn: [],
      minimum: ZERO_MINIMUMS,
      runTests: false,
    });

    assert.equal(result.passed, false);
    assert.match(
      findViolation(result, 'analysis_incomplete').message,
      /directory depth limit/,
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('fails closed instead of silently truncating candidate test-file discovery', async () => {
  const directory = createProject();
  try {
    const testsDirectory = path.join(directory, 'tests/generated');
    fs.mkdirSync(testsDirectory, { recursive: true });
    for (let index = 0; index <= 5_000; index += 1) {
      fs.writeFileSync(
        path.join(
          testsDirectory,
          `case-${index.toString().padStart(4, '0')}.spec.ts`,
        ),
        "import test from 'node:test';\n",
      );
    }

    const result = await validatePlaywrightTests(directory, {
      failOn: [],
      minimum: ZERO_MINIMUMS,
      runTests: false,
    });

    assert.equal(result.passed, false);
    assert.equal(result.testSummary.files, 0);
    const violation = findViolation(result, 'analysis_incomplete');
    assert.equal(violation.file, undefined);
    assert.match(violation.message, /5000-file analysis limit/);
    assert.deepEqual(
      result.feedback.items.map(({ code }) => code),
      ['analysis_incomplete'],
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('fails closed when candidate test sources exceed the aggregate analysis bound', async () => {
  const directory = createProject();
  try {
    const testsDirectory = path.join(directory, 'tests/generated');
    fs.mkdirSync(testsDirectory, { recursive: true });
    for (let index = 0; index < 26; index += 1) {
      const file = path.join(
        testsDirectory,
        `case-${index.toString().padStart(2, '0')}.spec.ts`,
      );
      fs.writeFileSync(file, "import test from 'node:test';\n");
      fs.truncateSync(file, 2 * 1024 * 1024);
    }

    const result = await validatePlaywrightTests(directory, {
      failOn: [],
      minimum: ZERO_MINIMUMS,
      runTests: false,
    });

    assert.equal(result.passed, false);
    assert.equal(result.testSummary.files, 0);
    const violation = findViolation(result, 'analysis_incomplete');
    assert.equal(violation.file, 'tests/generated/case-25.spec.ts');
    assert.match(violation.message, /aggregate analysis limit/);
    assert.deepEqual(
      result.feedback.items.map(({ code }) => code),
      ['analysis_incomplete'],
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('requirement evidence comes from test strings and annotations, not comments', async () => {
  const directory = createProject();
  try {
    writeProjectFile(
      directory,
      'tests/requirements.spec.ts',
      [
        "import { expect, test } from '@playwright/test';",
        '',
        "test('REQ-TITLE checkout succeeds', async ({ page }) => {",
        "  await expect(page.getByRole('status')).toHaveText('Paid');",
        '});',
        '',
        "test('comment-only requirement', async ({ page }) => {",
        '  // REQ-COMMENT is deliberately not evidence.',
        "  await expect(page.getByRole('status')).toHaveText('Ready');",
        '});',
        '',
        "test('annotated requirement', async ({ page }) => {",
        "  console.log('REQ-BODY');",
        '  test.info().annotations.push({',
        "    type: 'requirement',",
        "    description: 'REQ-ANNOTATED',",
        '  });',
        "  await expect(page.getByRole('status')).toHaveText('Ready');",
        '});',
        '',
      ].join('\n'),
    );

    const result = await validatePlaywrightTests(directory, {
      failOn: ['skipped_requirement'],
      minimum: ZERO_MINIMUMS,
      requirements: [
        'REQ-TITLE: Checkout succeeds',
        'REQ-COMMENT: This ID appears only in a source comment',
        'REQ-BODY: An unrelated body string is not evidence',
        '[critical] REQ-ANNOTATED: Evidence can be an annotation',
      ].join('\n'),
      runTests: false,
    });

    assert.equal(result.passed, false);
    assert.equal(result.requirements.total, 4);
    assert.equal(result.requirements.covered, 2);
    const byId = new Map(
      result.requirements.items.map((requirement) => [
        requirement.id,
        requirement,
      ]),
    );
    assert.deepEqual(byId.get('REQ-TITLE')?.evidence, [
      {
        file: 'tests/requirements.spec.ts',
        line: 3,
        test: 'REQ-TITLE checkout succeeds',
      },
    ]);
    assert.deepEqual(byId.get('REQ-COMMENT')?.evidence, []);
    assert.equal(byId.get('REQ-COMMENT')?.passed, false);
    assert.deepEqual(byId.get('REQ-BODY')?.evidence, []);
    assert.equal(byId.get('REQ-BODY')?.passed, false);
    assert.equal(byId.get('REQ-ANNOTATED')?.critical, true);
    assert.equal(byId.get('REQ-ANNOTATED')?.passed, true);
    assert.deepEqual(
      result.feedback.items.map((item) => item.code),
      ['skipped_requirement', 'skipped_requirement'],
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('an explicitly empty failOn list keeps AST findings informational', async () => {
  const directory = createProject();
  try {
    writeProjectFile(
      directory,
      'tests/informational.spec.ts',
      [
        "import { expect, test } from '@playwright/test';",
        '',
        "test.only('temporary test', async ({ page }) => {",
        '  await page.waitForTimeout(100);',
        '  expect(true).toBeTruthy();',
        '});',
        '',
      ].join('\n'),
    );

    const result = await validatePlaywrightTests(directory, {
      failOn: [],
      minimum: ZERO_MINIMUMS,
      runTests: false,
    });

    assert.equal(result.passed, true);
    assert.equal(result.status, 'passed');
    assert.deepEqual(result.feedback.items, []);
    assert.equal(result.feedback.summary, 'Validation passed.');
    assert.ok(result.violations.some(({ code }) => code === 'focused_test'));
    assert.ok(result.violations.some(({ code }) => code === 'hardcoded_wait'));
    assert.ok(
      result.violations.some(({ code }) => code === 'trivial_assertion'),
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('coverage thresholds are mandatory and feedback identifies the lowest files', async () => {
  const directory = createProject();
  try {
    writeProjectFile(directory, 'tests/coverage.spec.ts', meaningfulTest());
    writeProjectFile(
      directory,
      'coverage/coverage-final.json',
      JSON.stringify({
        'src/high.ts': istanbulFile({
          coveredBranches: 10,
          coveredLines: 10,
          totalBranches: 10,
          totalLines: 10,
        }),
        'src/low.ts': istanbulFile({
          coveredBranches: 1,
          coveredLines: 3,
          totalBranches: 10,
          totalLines: 10,
        }),
      }),
    );

    const result = await validatePlaywrightTests(directory, {
      coverageSummaryPaths: ['coverage/coverage-final.json'],
      failOn: [],
      minimum: {
        assertionQuality: 100,
        branchCoverage: 70,
        lineCoverage: 80,
        requirementCoverage: 100,
      },
      runTests: false,
    });

    assert.equal(result.passed, false);
    assert.deepEqual(result.dimensions.lineCoverage, {
      minimum: 80,
      observed: 65,
      passed: false,
    });
    assert.equal(result.dimensions.branchCoverage.minimum, 70);
    assert.ok(
      Math.abs((result.dimensions.branchCoverage.observed || 0) - 55) < 0.001,
    );
    assert.equal(result.dimensions.branchCoverage.passed, false);
    assert.deepEqual(
      result.feedback.items.map((item) => item.code),
      ['line_coverage', 'branch_coverage'],
    );
    for (const code of ['line_coverage', 'branch_coverage']) {
      const item = result.feedback.items.find(
        (candidate) => candidate.code === code,
      );
      assert.ok(item);
      assert.match(`${item.message}\n${item.remediation}`, /src\/low\.ts/);
    }
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('line and branch coverage feedback rank files by the failing dimension', async () => {
  const directory = createProject();
  try {
    writeProjectFile(
      directory,
      'tests/ranked-coverage.spec.ts',
      meaningfulTest(),
    );
    const lineLowFiles = Object.fromEntries(
      Array.from({ length: 6 }, (_, index) => [
        `src/line-low-${index}.ts`,
        istanbulFile({
          coveredBranches: 10,
          coveredLines: index,
          totalBranches: 10,
          totalLines: 100,
        }),
      ]),
    );
    writeProjectFile(
      directory,
      'coverage/coverage-final.json',
      JSON.stringify({
        ...lineLowFiles,
        'src/branch-low.ts': istanbulFile({
          coveredBranches: 0,
          coveredLines: 100,
          totalBranches: 100,
          totalLines: 100,
        }),
      }),
    );

    const result = await validatePlaywrightTests(directory, {
      coverageSummaryPaths: ['coverage/coverage-final.json'],
      failOn: [],
      minimum: {
        ...ZERO_MINIMUMS,
        branchCoverage: 70,
        lineCoverage: 80,
      },
      runTests: false,
    });

    const lineFeedback = findViolation(result, 'line_coverage').remediation;
    const branchFeedback = findViolation(result, 'branch_coverage').remediation;
    assert.match(lineFeedback, /src\/line-low-0\.ts/);
    assert.doesNotMatch(lineFeedback, /src\/branch-low\.ts/);
    assert.match(branchFeedback, /src\/branch-low\.ts/);
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('parses Istanbul coverage-final JSON into aggregate line and branch coverage', async () => {
  const directory = createProject();
  try {
    writeProjectFile(directory, 'tests/final.spec.ts', meaningfulTest());
    writeProjectFile(
      directory,
      'coverage/coverage-final.json',
      JSON.stringify({
        [path.join(directory, 'src/a.ts')]: {
          b: { 0: [1, 0] },
          s: { 0: 1, 1: 0, 2: 0 },
          statementMap: {
            0: { start: { line: 1 } },
            1: { start: { line: 1 } },
            2: { start: { line: 2 } },
          },
        },
        'src/b.ts': {
          b: { 0: [2, 1] },
          s: { 0: 2 },
          statementMap: { 0: { start: { line: 10 } } },
        },
      }),
    );

    const result = await validatePlaywrightTests(directory, {
      coverageSummaryPaths: ['coverage/coverage-final.json'],
      failOn: [],
      minimum: {
        assertionQuality: 100,
        branchCoverage: 70,
        lineCoverage: 60,
        requirementCoverage: 100,
      },
      runTests: false,
    });

    assert.equal(result.passed, true);
    assert.equal(result.artifacts.coverage, 'coverage/coverage-final.json');
    assert.ok(
      Math.abs((result.dimensions.lineCoverage.observed ?? 0) - 66.666_666) <
        0.001,
    );
    assert.equal(result.dimensions.branchCoverage.observed, 75);
    assert.deepEqual(result.dimensions.changedLineCoverage, {
      applicable: false,
      minimum: 80,
      observed: null,
      passed: true,
    });
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('gates executable changed lines using Istanbul coverage-final detail', async () => {
  const directory = createProject();
  try {
    writeProjectFile(
      directory,
      'tests/changed-final.spec.ts',
      meaningfulTest(),
    );
    writeProjectFile(
      directory,
      'coverage/coverage-final.json',
      JSON.stringify({
        [path.join(directory, 'src/changed.ts')]: {
          b: {},
          s: { 0: 1, 1: 0, 2: 0, 3: 0 },
          statementMap: {
            0: { start: { line: 2 } },
            1: { start: { line: 2 } },
            2: { start: { line: 3 } },
            3: { start: { line: 4 } },
          },
        },
      }),
    );

    const result = await validatePlaywrightTests(
      directory,
      {
        coverageSummaryPaths: ['coverage/coverage-final.json'],
        failOn: [],
        minimum: { ...ZERO_MINIMUMS, changedLineCoverage: 80 },
        runTests: false,
      },
      {
        changeManifest: productionChangeManifest([
          {
            changedLines: [{ end: 5, start: 2 }],
            path: 'src/changed.ts',
          },
        ]),
      },
    );

    assert.equal(result.passed, false);
    assert.equal(result.dimensions.changedLineCoverage.applicable, true);
    assert.ok(
      Math.abs(
        (result.dimensions.changedLineCoverage.observed ?? 0) - 33.333_333,
      ) < 0.001,
      JSON.stringify({
        changedCoverage: result.changedCoverage,
        dimension: result.dimensions.changedLineCoverage,
        violations: result.violations,
      }),
    );
    assert.equal(result.dimensions.changedLineCoverage.passed, false);
    assert.deepEqual(result.changedCoverage, {
      applicable: true,
      coveredLines: 1,
      instrumentedFiles: 1,
      missingFiles: [],
      productionFiles: 1,
      totalLines: 3,
      truncated: false,
      uncovered: [
        {
          file: 'src/changed.ts',
          lines: [3, 4],
          total: 2,
          truncated: false,
        },
      ],
    });
    assert.match(
      findViolation(result, 'changed_line_coverage').remediation,
      /src\/changed\.ts:3,4/,
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('maps LCOV DA records to changed lines and ignores non-executable diff lines', async () => {
  const directory = createProject();
  try {
    writeProjectFile(directory, 'tests/changed-lcov.spec.ts', meaningfulTest());
    writeProjectFile(
      directory,
      'coverage/lcov.info',
      [
        'SF:src/changed.ts',
        'DA:10,1',
        'DA:11,0',
        'LF:2',
        'LH:1',
        'end_of_record',
        '',
      ].join('\n'),
    );

    const result = await validatePlaywrightTests(
      directory,
      {
        coverageSummaryPaths: ['coverage/lcov.info'],
        failOn: [],
        minimum: { ...ZERO_MINIMUMS, changedLineCoverage: 50 },
        runTests: false,
      },
      {
        changeManifest: productionChangeManifest([
          {
            changedLines: [{ end: 12, start: 10 }],
            path: 'src/changed.ts',
          },
        ]),
      },
    );

    assert.equal(result.passed, true, result.feedbackText);
    assert.deepEqual(result.dimensions.changedLineCoverage, {
      applicable: true,
      minimum: 50,
      observed: 50,
      passed: true,
    });
    assert.equal(result.changedCoverage?.totalLines, 2);
    assert.deepEqual(result.changedCoverage?.uncovered[0]?.lines, [11]);
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('maps changed coverage from a configured subfolder to repository-root manifest paths', async () => {
  const repositoryRoot = createProject();
  const directory = path.join(repositoryRoot, 'apps/web');
  try {
    writeProjectFile(directory, 'tests/subfolder.spec.ts', meaningfulTest());
    writeProjectFile(
      directory,
      'coverage/coverage-final.json',
      JSON.stringify({
        'src/changed.ts': {
          b: {},
          s: { 0: 1 },
          statementMap: { 0: { start: { line: 7 } } },
        },
      }),
    );

    const result = await validatePlaywrightTests(
      directory,
      {
        coverageSummaryPaths: ['coverage/coverage-final.json'],
        failOn: [],
        minimum: { ...ZERO_MINIMUMS, changedLineCoverage: 100 },
        runTests: false,
      },
      {
        changeManifest: productionChangeManifest([
          {
            changedLines: [{ end: 7, start: 7 }],
            path: 'apps/web/src/changed.ts',
          },
        ]),
        repositoryRoot,
      },
    );

    assert.equal(result.passed, true, result.feedbackText);
    assert.equal(result.dimensions.changedLineCoverage.observed, 100);
    assert.equal(result.changedCoverage?.missingFiles.length, 0);
  } finally {
    fs.rmSync(repositoryRoot, { force: true, recursive: true });
  }
});

test('fails changed-code validation when only summary coverage is available', async () => {
  const directory = createProject();
  try {
    writeProjectFile(
      directory,
      'tests/changed-summary.spec.ts',
      meaningfulTest(),
    );
    writeProjectFile(
      directory,
      'coverage/coverage-summary.json',
      JSON.stringify({
        'src/changed.ts': {
          branches: { pct: 100 },
          lines: { pct: 100 },
        },
        total: { branches: { pct: 100 }, lines: { pct: 100 } },
      }),
    );

    const result = await validatePlaywrightTests(
      directory,
      {
        coverageSummaryPaths: ['coverage/coverage-summary.json'],
        failOn: [],
        minimum: { ...ZERO_MINIMUMS, changedLineCoverage: 80 },
        runTests: false,
      },
      {
        changeManifest: productionChangeManifest([
          {
            changedLines: [{ end: 2, start: 1 }],
            path: 'src/changed.ts',
          },
        ]),
      },
    );

    assert.equal(result.passed, false);
    assert.deepEqual(result.dimensions.changedLineCoverage, {
      applicable: true,
      minimum: 80,
      observed: null,
      passed: false,
    });
    assert.match(
      findViolation(result, 'changed_coverage_incomplete').remediation,
      /coverage-final\.json|LCOV/,
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('rejects summary paths even when a fixed detailed report is also present', async () => {
  const directory = createProject();
  try {
    writeProjectFile(directory, 'tests/detailed.spec.ts', meaningfulTest());
    writeProjectFile(
      directory,
      'coverage/coverage-summary.json',
      JSON.stringify({
        'src/changed.ts': {
          branches: { pct: 100 },
          lines: { pct: 100 },
        },
        total: { branches: { pct: 100 }, lines: { pct: 100 } },
      }),
    );
    writeProjectFile(
      directory,
      'coverage/coverage-final.json',
      JSON.stringify({
        'src/changed.ts': {
          b: {},
          s: { 0: 1 },
          statementMap: { 0: { start: { line: 4 } } },
        },
      }),
    );

    const result = await validatePlaywrightTests(
      directory,
      {
        coverageSummaryPaths: [
          'coverage/coverage-summary.json',
          'coverage/coverage-final.json',
        ],
        failOn: [],
        minimum: { ...ZERO_MINIMUMS, changedLineCoverage: 100 },
        runTests: false,
      },
      {
        changeManifest: productionChangeManifest([
          {
            changedLines: [{ end: 4, start: 4 }],
            path: 'src/changed.ts',
          },
        ]),
      },
    );

    assert.equal(result.passed, false);
    assert.match(
      findViolation(result, 'invalid_validator_configuration').message,
      /summary-only and arbitrary workspace paths/,
    );
    assert.equal(result.artifacts.coverage, 'coverage/coverage-final.json');
    assert.equal(result.dimensions.changedLineCoverage.observed, 100);
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('does not require line instrumentation for non-executable production assets', async () => {
  const directory = createProject();
  try {
    writeProjectFile(directory, 'tests/styles.spec.ts', meaningfulTest());

    const result = await validatePlaywrightTests(
      directory,
      {
        failOn: [],
        minimum: { ...ZERO_MINIMUMS, changedLineCoverage: 80 },
        runTests: false,
      },
      {
        changeManifest: productionChangeManifest([
          {
            changedLines: [{ end: 12, start: 4 }],
            path: 'src/dashboard.css',
          },
        ]),
      },
    );

    assert.equal(result.passed, true, result.feedbackText);
    assert.deepEqual(result.dimensions.changedLineCoverage, {
      applicable: false,
      minimum: 80,
      observed: null,
      passed: true,
    });
    assert.equal(
      result.violations.some(
        (violation) => violation.code === 'changed_coverage_incomplete',
      ),
      false,
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('parses LCOV records across files', async () => {
  const directory = createProject();
  try {
    writeProjectFile(directory, 'tests/lcov.spec.ts', meaningfulTest());
    writeProjectFile(
      directory,
      'coverage/lcov.info',
      [
        'TN:',
        'SF:src/a.ts',
        'DA:1,1',
        'DA:2,1',
        'DA:3,1',
        'DA:4,0',
        'LF:4',
        'LH:3',
        'BRF:2',
        'BRH:1',
        'end_of_record',
        'SF:src/b.ts',
        'DA:1,1',
        'DA:2,0',
        'LF:2',
        'LH:1',
        'BRF:3',
        'BRH:2',
        'end_of_record',
        '',
      ].join('\n'),
    );

    const result = await validatePlaywrightTests(directory, {
      coverageSummaryPaths: ['coverage/lcov.info'],
      failOn: [],
      minimum: {
        assertionQuality: 100,
        branchCoverage: 60,
        lineCoverage: 60,
        requirementCoverage: 100,
      },
      runTests: false,
    });

    assert.equal(result.passed, true);
    assert.equal(result.artifacts.coverage, 'coverage/lcov.info');
    assert.ok(
      Math.abs((result.dimensions.lineCoverage.observed ?? 0) - 66.666_666) <
        0.001,
    );
    assert.equal(result.dimensions.branchCoverage.observed, 60);
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('coverage artifacts without branch measurements fail enabled branch thresholds', async () => {
  const directory = createProject();
  try {
    writeProjectFile(directory, 'tests/branchless.spec.ts', meaningfulTest());
    const artifacts = [
      {
        contents: JSON.stringify({
          'src/final.ts': {
            s: { 0: 1 },
            statementMap: { 0: { start: { line: 1 } } },
          },
        }),
        coveragePath: 'coverage/coverage-final.json',
      },
      {
        contents: [
          'SF:src/lcov.ts',
          'DA:1,1',
          'LF:1',
          'LH:1',
          'end_of_record',
          '',
        ].join('\n'),
        coveragePath: 'coverage/lcov.info',
      },
    ];

    for (const { contents, coveragePath } of artifacts) {
      writeProjectFile(directory, coveragePath, contents);
      const result = await validatePlaywrightTests(directory, {
        coverageSummaryPaths: [coveragePath],
        failOn: [],
        minimum: { ...ZERO_MINIMUMS, branchCoverage: 70 },
        runTests: false,
      });

      assert.equal(result.passed, false, coveragePath);
      assert.deepEqual(result.dimensions.branchCoverage, {
        minimum: 70,
        observed: null,
        passed: false,
      });
      assert.equal(result.dimensions.lineCoverage.observed, 100);
      assert.equal(result.artifacts.coverage, coveragePath);
      assert.equal(
        result.violations.some(
          ({ code }) => code === 'invalid_coverage_artifact',
        ),
        false,
      );
      assert.match(
        findViolation(result, 'branch_coverage').message,
        /produced no result/,
      );
    }
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('rejects LCOV aggregate claims that disagree with detailed line records', async () => {
  const directory = createProject();
  try {
    writeProjectFile(
      directory,
      'tests/inconsistent-lcov.spec.ts',
      meaningfulTest(),
    );
    writeProjectFile(
      directory,
      'coverage/lcov.info',
      ['SF:src/forged.ts', 'DA:1,0', 'LF:1', 'LH:1', 'end_of_record', ''].join(
        '\n',
      ),
    );

    const result = await validatePlaywrightTests(directory, {
      coverageSummaryPaths: ['coverage/lcov.info'],
      failOn: [],
      minimum: ZERO_MINIMUMS,
      runTests: false,
    });

    assert.equal(result.passed, false);
    assert.match(
      findViolation(result, 'invalid_coverage_artifact').message,
      /aggregate line counts do not match DA records/,
    );
    assert.equal(result.coverageEvidence, undefined);
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('malformed coverage is a blocking artifact error even when thresholds are disabled', async () => {
  const directory = createProject();
  try {
    writeProjectFile(directory, 'tests/malformed.spec.ts', meaningfulTest());
    writeProjectFile(
      directory,
      'coverage/coverage-final.json',
      '{ malformed json',
    );

    const result = await validatePlaywrightTests(directory, {
      coverageSummaryPaths: ['coverage/coverage-final.json'],
      failOn: [],
      minimum: ZERO_MINIMUMS,
      runTests: false,
    });

    assert.equal(result.passed, false);
    assert.equal(result.artifacts.coverage, undefined);
    assert.equal(result.dimensions.lineCoverage.observed, null);
    assert.equal(result.dimensions.branchCoverage.observed, null);
    assert.equal(
      findViolation(result, 'invalid_coverage_artifact').file,
      'coverage/coverage-final.json',
    );
    assert.deepEqual(
      result.feedback.items.map((item) => item.code),
      ['invalid_coverage_artifact'],
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('empty coverage cannot satisfy enabled thresholds', async () => {
  const directory = createProject();
  try {
    writeProjectFile(
      directory,
      'tests/empty-coverage.spec.ts',
      meaningfulTest(),
    );
    writeProjectFile(
      directory,
      'coverage/coverage-final.json',
      JSON.stringify({}),
    );

    const result = await validatePlaywrightTests(directory, {
      coverageSummaryPaths: ['coverage/coverage-final.json'],
      failOn: [],
      minimum: {
        ...ZERO_MINIMUMS,
        branchCoverage: 70,
        lineCoverage: 80,
      },
      runTests: false,
    });

    assert.equal(result.passed, false);
    assert.equal(result.dimensions.lineCoverage.observed, null);
    assert.match(
      findViolation(result, 'invalid_coverage_artifact').message,
      /no measured source lines/,
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('authoritative cleanup rejects coverage through a symlink without deleting its target', async () => {
  const directory = createProject();
  const external = fs.mkdtempSync(
    path.join(os.tmpdir(), 'validator-external-'),
  );
  const externalCoverage = path.join(external, 'coverage-final.json');
  try {
    writeProjectFile(directory, 'tests/symlink.spec.ts', meaningfulTest());
    fs.writeFileSync(
      externalCoverage,
      JSON.stringify({
        'src/external.ts': istanbulFile({
          coveredBranches: 1,
          coveredLines: 1,
          totalBranches: 1,
          totalLines: 1,
        }),
      }),
    );
    fs.symlinkSync(external, path.join(directory, 'coverage'), 'dir');

    const result = await validatePlaywrightTests(
      directory,
      {
        coverageSummaryPaths: ['coverage/coverage-final.json'],
        failOn: [],
        minimum: ZERO_MINIMUMS,
        runTests: false,
      },
      { authoritative: true },
    );

    assert.equal(result.passed, false);
    assert.equal(fs.existsSync(externalCoverage), true);
    assert.match(
      findViolation(result, 'coverage_path_outside_workspace').message,
      /symbolic link or outside/,
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
    fs.rmSync(external, { force: true, recursive: true });
  }
});

test('missing coverage fails enabled thresholds with generation guidance', async () => {
  const directory = createProject();
  try {
    writeProjectFile(directory, 'tests/missing.spec.ts', meaningfulTest());

    const result = await validatePlaywrightTests(directory, {
      coverageSummaryPaths: ['coverage/coverage-final.json'],
      failOn: [],
      minimum: {
        ...ZERO_MINIMUMS,
        branchCoverage: 70,
        lineCoverage: 80,
      },
      runTests: false,
    });

    assert.equal(result.passed, false);
    assert.deepEqual(result.dimensions.lineCoverage, {
      minimum: 80,
      observed: null,
      passed: false,
    });
    assert.deepEqual(result.dimensions.branchCoverage, {
      minimum: 70,
      observed: null,
      passed: false,
    });
    assert.equal(
      result.violations.some(
        ({ code }) => code === 'invalid_coverage_artifact',
      ),
      false,
    );
    assert.match(
      findViolation(result, 'line_coverage').remediation,
      /coverage\/coverage-final\.json/,
    );
    assert.match(
      findViolation(result, 'branch_coverage').remediation,
      /coverage\/coverage-final\.json/,
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('rejects arbitrary workspace coverage report paths', async () => {
  const directory = createProject();
  try {
    writeProjectFile(
      directory,
      'tests/arbitrary-path.spec.ts',
      meaningfulTest(),
    );
    writeProjectFile(
      directory,
      'artifacts/coverage-final.json',
      JSON.stringify({
        'src/forged.ts': istanbulFile({
          coveredBranches: 1,
          coveredLines: 1,
          totalBranches: 1,
          totalLines: 1,
        }),
      }),
    );

    const result = await validatePlaywrightTests(directory, {
      coverageSummaryPaths: ['artifacts/coverage-final.json'],
      failOn: [],
      minimum: ZERO_MINIMUMS,
      runTests: false,
    });

    assert.equal(result.passed, false);
    assert.equal(result.artifacts.coverage, undefined);
    assert.match(
      findViolation(result, 'invalid_validator_configuration').message,
      /fixed to detailed artifacts/,
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('blocks tests that synthesize a fixed coverage report', async () => {
  const directory = createProject();
  try {
    writeProjectFile(
      directory,
      'tests/forged-coverage.spec.ts',
      [
        "import fs from 'node:fs';",
        "import { expect, test } from '@playwright/test';",
        '',
        "test('forges coverage', async ({ page }) => {",
        "  fs.writeFileSync('coverage/coverage-final.json', JSON.stringify({}));",
        "  await expect(page.getByRole('heading')).toHaveText('Dashboard');",
        '});',
        '',
      ].join('\n'),
    );
    writeProjectFile(
      directory,
      'coverage/coverage-final.json',
      JSON.stringify({
        'src/forged.ts': istanbulFile({
          coveredBranches: 1,
          coveredLines: 1,
          totalBranches: 1,
          totalLines: 1,
        }),
      }),
    );

    const result = await validatePlaywrightTests(directory, {
      failOn: [],
      minimum: ZERO_MINIMUMS,
      runTests: false,
    });

    assert.equal(result.passed, false);
    const violation = findViolation(result, 'coverage_artifact_synthesis');
    assert.equal(violation.file, 'tests/forged-coverage.spec.ts');
    assert.equal(violation.line, 5);
    assert.match(violation.remediation, /Remove coverage-file writes/);
    assert.equal(
      result.coverageEvidence?.provenance,
      'repository_reported_untrusted',
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('blocks executable test configuration and coverage-global synthesis', async () => {
  const directory = createProject();
  try {
    writeProjectFile(directory, 'tests/config.spec.ts', meaningfulTest());
    writeProjectFile(
      directory,
      'playwright.config.ts',
      [
        "import { writeFileSync as persist } from 'node:fs';",
        '',
        "persist('coverage/coverage-final.json', '{}');",
        'export default {};',
        '',
      ].join('\n'),
    );
    writeProjectFile(
      directory,
      'tests/global-coverage.spec.ts',
      [
        "import { expect, test } from '@playwright/test';",
        '',
        "test('mutates the coverage global', async ({ page }) => {",
        '  globalThis.__coverage__ = {};',
        "  await expect(page.getByRole('heading')).toHaveText('Dashboard');",
        '});',
        '',
      ].join('\n'),
    );

    const result = await validatePlaywrightTests(directory, {
      failOn: [],
      minimum: ZERO_MINIMUMS,
      runTests: false,
    });

    assert.equal(result.passed, false);
    const synthesisFiles = result.violations
      .filter(({ code }) => code === 'coverage_artifact_synthesis')
      .map(({ file }) => file)
      .sort();
    assert.deepEqual(synthesisFiles, [
      'playwright.config.ts',
      'tests/global-coverage.spec.ts',
    ]);
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('retry enforcement rejects comments, nonzero values, and conflicting flags', async () => {
  const directory = createProject();
  try {
    writeProjectFile(directory, 'tests/retry-policy.spec.ts', meaningfulTest());
    const commands = [
      {
        command: 'playwright test # --retries=0',
        message: /shell comment/,
      },
      {
        command: 'playwright test --retries=2',
        message: /nonzero --retries/,
      },
      {
        command: 'playwright test --retries=0 --retries=2',
        message: /conflicting, or nonzero --retries/,
      },
      {
        command: 'echo --retries=0; playwright test',
        message: /one simple command/,
      },
      {
        command: 'playwright "$TEST_ACTION" --retries=0',
        message: /cannot use shell expansion/,
      },
      {
        command: "sh -c 'playwright test --retries=1' ignored --retries=0",
        message: /cannot invoke sh/,
      },
      {
        command:
          "command /bin/bash -c 'playwright test --retries=1' ignored --retries=0",
        message: /cannot invoke bash/,
      },
      {
        command: "eval 'playwright test --retries=1 # hidden' --retries=0",
        message: /cannot invoke eval/,
      },
      {
        command: `env -S "sh -c 'playwright test --retries=1' ignored" --retries=0`,
        message: /env command-string splitting/,
      },
    ];

    for (const { command, message } of commands) {
      let invoked = false;
      const result = await validatePlaywrightTests(
        directory,
        {
          failOn: [],
          minimum: ZERO_MINIMUMS,
          validationCommand: command,
        },
        {
          runCommand: async () => {
            invoked = true;
            return successfulProcess();
          },
        },
      );

      assert.equal(result.passed, false, command);
      assert.equal(invoked, false, command);
      assert.match(
        findViolation(result, 'retry_policy_not_enforced').message,
        message,
      );
      assert.deepEqual(
        result.feedback.items.map(({ code }) => code),
        ['retry_policy_not_enforced'],
      );
    }

    const valid = await validatePlaywrightTests(
      directory,
      {
        failOn: [],
        minimum: ZERO_MINIMUMS,
        validationCommand: 'playwright test --retries 0',
      },
      {
        runCommand: async (_command, _cwd, _timeout, environment) => {
          writePlaywrightJsonReport(
            directory,
            [{ file: 'tests/retry-policy.spec.ts' }],
            environment?.PLAYWRIGHT_JSON_OUTPUT_FILE,
          );
          return successfulProcess();
        },
      },
    );
    assert.equal(valid.passed, true);
    assert.equal(
      valid.violations.some(({ code }) => code === 'retry_policy_not_enforced'),
      false,
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('authoritative validation rejects every partial-suite selector', async () => {
  const directory = createProject();
  try {
    writeProjectFile(directory, 'tests/full-suite.spec.ts', meaningfulTest());
    const commands = [
      'playwright test --retries=0 --grep checkout',
      'playwright test --retries=0 --grep-invert slow',
      'playwright test --retries=0 --project chromium',
      'playwright test --retries=0 --shard=1/2',
      'playwright test --retries=0 --last-failed',
      'playwright test --retries=0 --only-changed',
      'playwright test --retries=0 --list',
      'playwright test --retries=0 tests/full-suite.spec.ts',
      'playwright test --retries=0 -- tests/full-suite.spec.ts',
    ];

    for (const command of commands) {
      let invoked = false;
      const result = await validatePlaywrightTests(
        directory,
        {
          failOn: [],
          minimum: ZERO_MINIMUMS,
          validationCommand: command,
        },
        {
          runCommand: async () => {
            invoked = true;
            return successfulProcess();
          },
        },
      );

      assert.equal(invoked, false, command);
      assert.equal(result.passed, false, command);
      assert.match(
        findViolation(result, 'partial_test_selection').message,
        /complete configured suite/,
      );
    }
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('requirement evidence must come from a test Playwright actually passed', async () => {
  const directory = createProject();
  try {
    writeProjectFile(
      directory,
      'tests/requirements.spec.ts',
      [
        "import { expect, test } from '@playwright/test';",
        '',
        "test('REQ-PASSED rendered behavior', async ({ page }) => {",
        "  await expect(page.getByRole('status')).toHaveText('Ready');",
        '});',
        '',
        "test('REQ-FILTERED hidden behavior', async ({ page }) => {",
        "  await expect(page.getByRole('status')).toHaveText('Hidden');",
        '});',
        '',
      ].join('\n'),
    );

    const result = await validatePlaywrightTests(
      directory,
      {
        failOn: ['skipped_requirement'],
        minimum: { ...ZERO_MINIMUMS, requirementCoverage: 100 },
        requirements: [
          'REQ-PASSED: rendered behavior is visible',
          'REQ-FILTERED: hidden behavior is visible',
        ].join('\n'),
        validationCommand: 'playwright test --reporter=html --retries=0',
      },
      {
        runCommand: async (command, _cwd, _timeout, environment) => {
          assert.equal(
            command,
            `playwright test --retries=0 --config=${path.join(directory, '.playrunner-validator.config.ts')}`,
          );
          writePlaywrightJsonReport(
            directory,
            [
              {
                file: 'tests/requirements.spec.ts',
                line: 3,
                title: 'REQ-PASSED rendered behavior',
              },
            ],
            environment?.PLAYWRIGHT_JSON_OUTPUT_FILE,
          );
          return successfulProcess({
            stdout:
              '[1/1] [chromium] › tests/requirements.spec.ts:3:1 › REQ-PASSED rendered behavior\n1 passed\n',
          });
        },
      },
    );

    assert.equal(result.passed, false);
    assert.equal(result.requirements.covered, 1);
    assert.equal(result.dimensions.requirementCoverage.observed, 50);
    assert.deepEqual(result.testRun.failedTests, []);
    const requirements = new Map(
      result.requirements.items.map((requirement) => [
        requirement.id,
        requirement,
      ]),
    );
    assert.equal(requirements.get('REQ-PASSED')?.passed, true);
    assert.equal(requirements.get('REQ-FILTERED')?.passed, false);
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('a missing authoritative Playwright JSON result fails closed', async () => {
  const directory = createProject();
  try {
    writeProjectFile(directory, 'tests/report.spec.ts', meaningfulTest());
    const result = await validatePlaywrightTests(
      directory,
      {
        failOn: [],
        minimum: ZERO_MINIMUMS,
        validationCommand: 'playwright test --retries=0',
      },
      { runCommand: async () => successfulProcess({ stdout: '1 passed\n' }) },
    );

    assert.equal(result.passed, false);
    assert.equal(result.testRun.passed, false);
    assert.deepEqual(result.testRun.failedTests, []);
    assert.match(
      findViolation(result, 'invalid_test_report').message,
      /was not produced/,
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('validation is independent of package.json scripts', async () => {
  const directory = createProject();
  try {
    writeProjectFile(
      directory,
      'tests/direct-policy.spec.ts',
      meaningfulTest(),
    );
    writeProjectFile(
      directory,
      'package.json',
      `${JSON.stringify({ scripts: { test: 'exit 99', 'test:coverage': 'exit 98' } }, null, 2)}\n`,
    );

    let directInvoked = false;
    const direct = await validatePlaywrightTests(
      directory,
      {
        failOn: [],
        minimum: ZERO_MINIMUMS,
        validationCommand: 'playwright test --reporter=line --retries=0',
      },
      {
        runCommand: async (_command, _cwd, _timeout, environment) => {
          directInvoked = true;
          writePlaywrightJsonReport(
            directory,
            [{ file: 'tests/direct-policy.spec.ts' }],
            environment?.PLAYWRIGHT_JSON_OUTPUT_FILE,
          );
          return successfulProcess();
        },
      },
    );
    assert.equal(directInvoked, true);
    assert.equal(direct.passed, true);

    let packageScriptInvoked = false;
    const packageScript = await validatePlaywrightTests(
      directory,
      {
        failOn: [],
        minimum: ZERO_MINIMUMS,
        validationCommand: 'npm run test:coverage -- --retries=0',
      },
      {
        runCommand: async () => {
          packageScriptInvoked = true;
          return successfulProcess();
        },
      },
    );
    assert.equal(packageScriptInvoked, false);
    assert.equal(packageScript.passed, false);
    assert.match(
      findViolation(packageScript, 'retry_policy_not_enforced').message,
      /container-owned.*package scripts/i,
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('an oversized validation command fails closed without execution or inline expansion', async () => {
  const directory = createProject();
  try {
    writeProjectFile(
      directory,
      'tests/command-bounds.spec.ts',
      meaningfulTest(),
    );
    let invoked = false;

    const result = await validatePlaywrightTests(
      directory,
      {
        failOn: [],
        minimum: ZERO_MINIMUMS,
        validationCommand: `playwright test --retries=0 ${'X'.repeat(VALIDATOR_LIMITS.validationCommandBytes)}`,
      },
      {
        runCommand: async () => {
          invoked = true;
          return successfulProcess();
        },
      },
    );

    assert.equal(invoked, false);
    assert.equal(result.passed, false);
    assert.equal(result.testRun.passed, false);
    assert.ok(result.testRun.command);
    assert.ok(
      Buffer.byteLength(result.testRun.command, 'utf8') <=
        VALIDATOR_LIMITS.inlineCommandBytes,
    );
    assert.match(
      findViolation(result, 'invalid_validator_configuration').message,
      /Validation command exceeds/,
    );
    assert.equal(
      result.violations.some(({ code }) => code === 'test_failure'),
      false,
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('process output, failed test names, and remediation remain bounded', async () => {
  const directory = createProject();
  try {
    writeProjectFile(
      directory,
      'tests/output-bounds.spec.ts',
      meaningfulTest(),
    );
    const longFailureName = `${'failure-'.repeat(1_000)}.spec.ts:1:1`;

    const result = await validatePlaywrightTests(
      directory,
      {
        failOn: [],
        minimum: ZERO_MINIMUMS,
        validationCommand: 'playwright test --retries=0',
      },
      {
        runCommand: async (_command, _cwd, _timeout, environment) => {
          writePlaywrightJsonReport(
            directory,
            [
              {
                file: longFailureName,
                line: 1,
                outcome: 'unexpected',
                resultStatus: 'failed',
                title: longFailureName,
              },
            ],
            environment?.PLAYWRIGHT_JSON_OUTPUT_FILE,
          );
          return successfulProcess({
            code: 1,
            stderr: '\\'.repeat(100_000),
            stdout: `1) ${longFailureName}\n`,
          });
        },
      },
    );

    const failure = findViolation(result, 'test_failure');
    assert.ok(
      Buffer.byteLength(failure.remediation, 'utf8') <=
        VALIDATOR_LIMITS.violationRemediationBytes,
    );
    assert.ok(
      Buffer.byteLength(result.feedback.items[0]?.remediation || '', 'utf8') <=
        VALIDATOR_LIMITS.violationRemediationBytes,
    );
    assert.ok(Buffer.byteLength(result.testRun.stderrTail, 'utf8') <= 6_000);
    assert.equal(result.testRun.failedTests.length, 1);
    assert.ok(
      Buffer.byteLength(result.testRun.failedTests[0], 'utf8') <=
        VALIDATOR_LIMITS.failedTestNameBytes,
    );
    assert.ok(
      Buffer.byteLength(JSON.stringify(result, null, 2), 'utf8') <
        VALIDATOR_LIMITS.inlineResultBytes,
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('a failed validation command returns actionable output and failed test names', async () => {
  const directory = createProject();
  try {
    writeProjectFile(directory, 'tests/command.spec.ts', meaningfulTest());
    writeProjectFile(directory, 'tests/checkout.spec.ts', meaningfulTest());
    let invocation: [string, string, number] | undefined;

    const result = await validatePlaywrightTests(
      directory,
      {
        failOn: [],
        minimum: ZERO_MINIMUMS,
        validationCommand: 'playwright test --reporter=line --retries=0',
        validationTimeoutMinutes: 4,
      },
      {
        runCommand: async (command, cwd, timeoutMs, environment) => {
          invocation = [command, cwd, timeoutMs];
          writePlaywrightJsonReport(
            directory,
            [
              {
                column: 3,
                file: 'tests/checkout.spec.ts',
                line: 12,
                outcome: 'unexpected',
                project: '',
                resultStatus: 'failed',
                title: 'checkout displays dashboard',
              },
            ],
            environment?.PLAYWRIGHT_JSON_OUTPUT_FILE,
          );
          return successfulProcess({
            code: 7,
            durationMs: 321,
            signal: null,
            stderr: 'Expected dashboard to be visible\n',
            stdout:
              '1) tests/checkout.spec.ts:12:3 › checkout displays dashboard\n',
          });
        },
      },
    );

    assert.deepEqual(invocation, [
      `playwright test --retries=0 --config=${path.join(directory, '.playrunner-validator.config.ts')}`,
      directory,
      240_000,
    ]);
    assert.equal(result.passed, false);
    assert.deepEqual(result.testRun, {
      command: 'playwright test --reporter=line --retries=0',
      durationMs: 321,
      exitCode: 7,
      failedTests: [
        'tests/checkout.spec.ts:12:3 › checkout displays dashboard',
      ],
      passed: false,
      stderrTail: 'Expected dashboard to be visible\n',
      stdoutTail:
        '1) tests/checkout.spec.ts:12:3 › checkout displays dashboard\n',
      timedOut: false,
    });
    assert.match(
      findViolation(result, 'test_failure').remediation,
      /Expected dashboard to be visible/,
    );
    assert.deepEqual(
      result.feedback.items.map((item) => item.code),
      ['test_failure'],
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('a timed-out validation command fails even when a TERM trap exits zero', async () => {
  const directory = createProject();
  try {
    writeProjectFile(directory, 'tests/timeout.spec.ts', meaningfulTest());

    const result = await validatePlaywrightTests(
      directory,
      {
        failOn: [],
        minimum: ZERO_MINIMUMS,
        validationCommand: 'playwright test --retries=0',
        validationTimeoutMinutes: 1,
      },
      {
        runCommand: async () =>
          successfulProcess({
            code: 0,
            durationMs: 60_001,
            signal: 'SIGTERM',
            stderr: 'Terminated\n',
            timedOut: true,
          }),
      },
    );

    assert.equal(result.passed, false);
    assert.equal(result.testRun.exitCode, 0);
    assert.equal(result.testRun.durationMs, 60_001);
    assert.equal(result.testRun.passed, false);
    assert.equal(result.testRun.timedOut, true);
    assert.equal(
      result.violations.some(({ code }) => code === 'test_failure'),
      false,
    );
    assert.match(
      findViolation(result, 'validation_timeout').message,
      /exceeded 1 minutes/,
    );
    assert.deepEqual(
      result.feedback.items.map((item) => item.code),
      ['validation_timeout'],
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});
