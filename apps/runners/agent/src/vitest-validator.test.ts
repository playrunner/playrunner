import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ProcessResult } from './process';
import {
  runVitestCoverage,
  VITEST_COVERAGE_DIRECTORY,
  VITEST_COVERAGE_REPORT,
  VITEST_LCOV_REPORT,
  VITEST_RESULTS_REPORT,
} from './vitest-validator';

function fixture(): string {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'playrunner-vitest-test-'),
  );
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'src', 'example.ts'),
    'export const n = 1;\n',
  );
  return root;
}

function processResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
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

function writeTestResults(root: string, total: number): void {
  const target = path.join(root, ...VITEST_RESULTS_REPORT.split('/'));
  const testFile = path.join(
    fs.realpathSync(root),
    'src',
    'example.unit.test.ts',
  );
  if (total && !fs.existsSync(testFile)) {
    fs.writeFileSync(testFile, '// Vitest report fixture.\n');
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    JSON.stringify({
      numFailedTests: 0,
      numPassedTests: total,
      numPendingTests: 0,
      numTodoTests: 0,
      numTotalTests: total,
      success: true,
      testResults: total
        ? [
            {
              assertionResults: Array.from({ length: total }, (_, index) => ({
                status: 'passed',
                title: `unit ${index + 1}`,
              })),
              name: testFile,
              status: 'passed',
            },
          ]
        : [],
    }),
  );
}

function writeCoverage(root: string): void {
  const target = path.join(root, ...VITEST_COVERAGE_REPORT.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    JSON.stringify({
      [path.join(fs.realpathSync(root), 'src', 'example.ts')]: {
        b: {},
        branchMap: {},
        f: {},
        fnMap: {},
        path: path.join(root, 'src', 'example.ts'),
        s: { 0: 1 },
        statementMap: {
          0: {
            end: { column: 19, line: 1 },
            start: { column: 0, line: 1 },
          },
        },
      },
    }),
  );
  fs.writeFileSync(
    path.join(root, ...VITEST_LCOV_REPORT.split('/')),
    `SF:${path.join(root, 'src', 'example.ts')}\nDA:1,1\nend_of_record\n`,
  );
}

function writeCoverageFiles(
  root: string,
  files: Array<{ executable?: boolean; relativePath: string }>,
): void {
  const target = path.join(root, ...VITEST_COVERAGE_REPORT.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const coverage: Record<string, unknown> = {};
  for (const file of files) {
    const absolute = path.join(
      fs.realpathSync(root),
      ...file.relativePath.split('/'),
    );
    const executable = file.executable !== false;
    coverage[absolute] = {
      b: {},
      branchMap: {},
      f: {},
      fnMap: {},
      path: absolute,
      s: executable ? { 0: 1 } : {},
      statementMap: executable
        ? {
            0: {
              end: { column: 1, line: 1 },
              start: { column: 0, line: 1 },
            },
          }
        : {},
    };
  }
  fs.writeFileSync(target, JSON.stringify(coverage));
  fs.writeFileSync(
    path.join(root, ...VITEST_LCOV_REPORT.split('/')),
    'end_of_record\n',
  );
}

function mutateJsonReport(
  root: string,
  relativePath: string,
  mutate: (value: Record<string, unknown>) => void,
): void {
  const target = path.join(root, ...relativePath.split('/'));
  const value = JSON.parse(fs.readFileSync(target, 'utf8')) as Record<
    string,
    unknown
  >;
  mutate(value);
  fs.writeFileSync(target, JSON.stringify(value));
}

test('runs the container-owned Vitest binary with fixed authoritative arguments', async () => {
  const root = fixture();
  try {
    let invocation:
      | {
          args: string[];
          command: string;
          config: string;
          configDirectoryMode: number;
          configMode: number;
          cwd?: string;
        }
      | undefined;
    const result = await runVitestCoverage(root, {
      runCommand: async (command, args, options) => {
        const configIndex = args.indexOf('--config');
        invocation = {
          args,
          command,
          config: fs.readFileSync(args[configIndex + 1], 'utf8'),
          configDirectoryMode:
            fs.statSync(path.dirname(args[configIndex + 1])).mode & 0o7777,
          configMode: fs.statSync(args[configIndex + 1]).mode & 0o777,
          cwd: options.cwd,
        };
        writeTestResults(root, 2);
        writeCoverage(root);
        return processResult();
      },
    });

    assert.equal(invocation?.command, 'vitest');
    assert.equal(invocation?.cwd, fs.realpathSync(root));
    assert.equal(invocation?.configDirectoryMode, 0o1777);
    assert.equal(invocation?.configMode, 0o444);
    assert.equal(invocation?.args[0], 'run');
    assert.ok(invocation?.args.includes('--reporter=json'));
    assert.ok(
      invocation?.args.includes(`--outputFile=${VITEST_RESULTS_REPORT}`),
    );
    assert.ok(invocation?.args.includes('--coverage.enabled=true'));
    assert.ok(invocation?.args.includes('--coverage.provider=v8'));
    assert.ok(invocation?.args.includes('--coverage.reporter=json'));
    assert.ok(invocation?.args.includes('--coverage.reporter=lcov'));
    assert.ok(
      invocation?.args.includes(
        `--coverage.reportsDirectory=${VITEST_COVERAGE_DIRECTORY}`,
      ),
    );
    assert.ok(invocation?.args.includes('--passWithNoTests=false'));
    assert.doesNotMatch(invocation?.args.join(' ') || '', /npm|pnpm|yarn/);
    assert.match(invocation?.config || '', /\.unit\.test/);
    assert.match(invocation?.config || '', /\.unit\.spec/);
    assert.match(invocation?.config || '', /src\/\*\*\//);
    assert.match(invocation?.config || '', /app\/\*\*\//);
    assert.match(invocation?.config || '', /lib\/\*\*\//);
    assert.match(invocation?.config || '', /server\/\*\*\//);
    assert.match(invocation?.config || '', /client\/\*\*\//);
    assert.match(invocation?.config || '', /api\/\*\*\//);
    assert.match(invocation?.config || '', /apps\/\*\/\*\*\//);
    assert.match(invocation?.config || '', /packages\/\*\/\*\*\//);
    assert.match(invocation?.config || '', /node_modules/);
    assert.match(invocation?.config || '', /__generated__/);
    assert.match(invocation?.config || '', /\.d\./);
    assert.match(invocation?.config || '', /"requireAssertions":true/);
    assert.equal(result.passed, true);
    assert.equal(result.failure, null);
    assert.equal(result.testCount, 2);
    assert.equal(result.coverageReportPath, VITEST_COVERAGE_REPORT);
    assert.equal(result.lcovReportPath, VITEST_LCOV_REPORT);
    assert.equal(result.testResultsPath, VITEST_RESULTS_REPORT);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('produces detailed coverage with the pinned Vitest toolchain', async () => {
  const root = fixture();
  try {
    fs.symlinkSync(
      path.join(process.cwd(), 'node_modules'),
      path.join(root, 'node_modules'),
      'dir',
    );
    fs.writeFileSync(
      path.join(root, 'src', 'example.unit.test.ts'),
      [
        "import { expect, test } from 'vitest';",
        "import { n } from './example';",
        "test('reads the exported value', () => expect(n).toBe(1));",
        '',
      ].join('\n'),
    );
    const result = await runVitestCoverage(root, {
      environment: {
        ...process.env,
        PATH: `${path.join(process.cwd(), 'node_modules', '.bin')}:${process.env.PATH || ''}`,
      },
      timeoutMs: 30_000,
    });

    assert.equal(
      result.passed,
      true,
      [result.failureMessage, result.stderr, result.stdout]
        .filter(Boolean)
        .join('\n'),
    );
    assert.equal(result.testCount, 1);
    assert.equal(result.coverageReportPath, VITEST_COVERAGE_REPORT);
    const coverage = JSON.parse(
      fs.readFileSync(
        path.join(root, ...VITEST_COVERAGE_REPORT.split('/')),
        'utf8',
      ),
    ) as Record<string, unknown>;
    assert.ok(
      Object.keys(coverage).some((file) => file.endsWith('/src/example.ts')),
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('requires every inventoried production source file in detailed coverage', async () => {
  const root = fixture();
  try {
    fs.writeFileSync(
      path.join(root, 'src', 'not-imported.ts'),
      'export const hidden = 2;\n',
    );
    const result = await runVitestCoverage(root, {
      runCommand: async () => {
        writeTestResults(root, 1);
        writeCoverage(root);
        return processResult();
      },
    });

    assert.equal(result.passed, false);
    assert.equal(result.failure, 'invalid_coverage');
    assert.equal(result.lineCoverage, null);
    assert.match(result.failureMessage || '', /omitted 1 inventoried/i);
    assert.match(result.failureMessage || '', /src\/not-imported\.ts/);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('computes thresholds from inventoried production sources only', async () => {
  const root = fixture();
  try {
    const result = await runVitestCoverage(root, {
      minimumLineCoverage: 80,
      runCommand: async () => {
        writeTestResults(root, 1);
        writeCoverage(root);
        mutateJsonReport(root, VITEST_COVERAGE_REPORT, (coverage) => {
          const production = Object.values(coverage)[0] as {
            s: Record<string, number>;
          };
          production.s['0'] = 0;
          const extraPath = path.join(
            fs.realpathSync(root),
            'scripts',
            'not-production.ts',
          );
          const statementMap: Record<string, unknown> = {};
          const hits: Record<string, number> = {};
          for (let index = 0; index < 9; index += 1) {
            statementMap[String(index)] = {
              end: { column: 1, line: index + 1 },
              start: { column: 0, line: index + 1 },
            };
            hits[String(index)] = 1;
          }
          coverage[extraPath] = {
            b: {},
            branchMap: {},
            s: hits,
            statementMap,
          };
        });
        return processResult();
      },
    });

    assert.equal(result.passed, false);
    assert.equal(
      result.failure,
      'line_coverage',
      result.failureMessage || 'unexpected failure',
    );
    assert.equal(result.lineCoverage, 0);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('fails closed when no supported production source exists', async () => {
  const root = fixture();
  try {
    fs.rmSync(path.join(root, 'src', 'example.ts'));
    const result = await runVitestCoverage(root, {
      runCommand: async () => {
        writeTestResults(root, 1);
        writeCoverage(root);
        return processResult();
      },
    });

    assert.equal(result.passed, false);
    assert.equal(result.failure, 'invalid_coverage');
    assert.match(result.failureMessage || '', /No supported production/i);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('inventories conventional roots and monorepo projects while allowing type-only files', async () => {
  const root = fixture();
  const files = [
    { relativePath: 'src/example.ts' },
    { relativePath: 'client/browser.ts' },
    { relativePath: 'api/handler.ts' },
    { relativePath: 'apps/web/app.tsx' },
    { relativePath: 'packages/core/index.mjs' },
    { executable: false, relativePath: 'packages/core/src/types.ts' },
  ];
  try {
    for (const file of files.slice(1)) {
      const absolute = path.join(root, ...file.relativePath.split('/'));
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(
        absolute,
        file.executable === false
          ? 'export type Identifier = string;\n'
          : 'export const value = 1;\n',
      );
    }
    const result = await runVitestCoverage(root, {
      minimumLineCoverage: 100,
      runCommand: async () => {
        writeTestResults(root, 1);
        writeCoverageFiles(root, files);
        return processResult();
      },
    });

    assert.equal(result.passed, true, result.failureMessage || 'failed');
    assert.equal(result.lineCoverage, 100);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('excludes tests, declarations, tooling config, generated files, and build output from inventory', async () => {
  const root = fixture();
  const excluded = [
    'src/example.test.ts',
    'src/example.spec.ts',
    'src/example.d.ts',
    'src/vite.config.ts',
    'src/generated/client.ts',
    'src/__generated__/schema.ts',
    'src/build/bundle.js',
    'src/tests/helper.ts',
    'packages/core/node_modules/dependency.js',
  ];
  try {
    for (const relativePath of excluded) {
      const absolute = path.join(root, ...relativePath.split('/'));
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, 'export const ignored = true;\n');
    }
    const result = await runVitestCoverage(root, {
      runCommand: async () => {
        writeTestResults(root, 1);
        writeCoverage(root);
        return processResult();
      },
    });

    assert.equal(result.passed, true, result.failureMessage || 'failed');
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('fails a unit test that executes without an assertion', async () => {
  const root = fixture();
  try {
    fs.symlinkSync(
      path.join(process.cwd(), 'node_modules'),
      path.join(root, 'node_modules'),
      'dir',
    );
    fs.writeFileSync(
      path.join(root, 'src', 'empty.unit.test.ts'),
      [
        "import { test } from 'vitest';",
        "import { n } from './example';",
        "test('reads without checking', () => { void n; });",
        '',
      ].join('\n'),
    );

    const result = await runVitestCoverage(root, {
      environment: {
        ...process.env,
        PATH: `${path.join(process.cwd(), 'node_modules', '.bin')}:${process.env.PATH || ''}`,
      },
      timeoutMs: 30_000,
    });

    assert.equal(result.passed, false);
    assert.equal(result.failure, 'test_failure');
    assert.notEqual(result.code, 0);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('clears stale coverage before the authoritative run', async () => {
  const root = fixture();
  try {
    writeTestResults(root, 99);
    writeCoverage(root);
    const result = await runVitestCoverage(root, {
      runCommand: async () => {
        writeTestResults(root, 1);
        return processResult();
      },
    });

    assert.equal(result.passed, false);
    assert.equal(result.failure, 'coverage_missing');
    assert.equal(result.coverageReportPath, null);
    assert.equal(
      fs.existsSync(path.join(root, ...VITEST_COVERAGE_REPORT.split('/'))),
      false,
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('rejects a symlinked test-results directory before cleanup', async () => {
  const root = fixture();
  const external = fs.mkdtempSync(
    path.join(os.tmpdir(), 'playrunner-vitest-external-'),
  );
  try {
    fs.symlinkSync(external, path.join(root, 'test-results'), 'dir');
    await assert.rejects(
      () => runVitestCoverage(root),
      /test-results must be a regular directory inside/i,
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
    fs.rmSync(external, { force: true, recursive: true });
  }
});

test('fails closed when no explicit unit tests execute', async () => {
  const root = fixture();
  try {
    const result = await runVitestCoverage(root, {
      runCommand: async () => {
        writeTestResults(root, 0);
        writeCoverage(root);
        return processResult();
      },
    });

    assert.equal(result.passed, false);
    assert.equal(result.failure, 'no_tests');
    assert.match(result.failureMessage || '', /No explicit/);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('rejects malformed or non-unit Vitest JSON evidence', async (context) => {
  const cases: Array<{
    mutate: (report: Record<string, unknown>, root: string) => void;
    name: string;
  }> = [
    {
      name: 'unsuccessful report',
      mutate: (report) => {
        report.success = false;
      },
    },
    {
      name: 'pending test',
      mutate: (report) => {
        report.numPassedTests = 0;
        report.numPendingTests = 1;
        const result = (
          report.testResults as Array<Record<string, unknown>>
        )[0];
        const assertion = (
          result.assertionResults as Array<Record<string, unknown>>
        )[0];
        assertion.status = 'pending';
      },
    },
    {
      name: 'todo test',
      mutate: (report) => {
        report.numPassedTests = 0;
        report.numTodoTests = 1;
        const result = (
          report.testResults as Array<Record<string, unknown>>
        )[0];
        const assertion = (
          result.assertionResults as Array<Record<string, unknown>>
        )[0];
        assertion.status = 'todo';
      },
    },
    {
      name: 'assertion aggregate mismatch',
      mutate: (report) => {
        const result = (
          report.testResults as Array<Record<string, unknown>>
        )[0];
        const assertion = (
          result.assertionResults as Array<Record<string, unknown>>
        )[0];
        assertion.status = 'failed';
      },
    },
    {
      name: 'missing test filename',
      mutate: (report) => {
        const result = (
          report.testResults as Array<Record<string, unknown>>
        )[0];
        delete result.name;
      },
    },
    {
      name: 'non-unit test filename',
      mutate: (report, root) => {
        const ordinaryTest = path.join(
          fs.realpathSync(root),
          'src',
          'example.test.ts',
        );
        fs.writeFileSync(ordinaryTest, '// Not an explicit unit test.\n');
        const result = (
          report.testResults as Array<Record<string, unknown>>
        )[0];
        result.name = ordinaryTest;
      },
    },
    {
      name: 'test filename outside the workspace',
      mutate: (report, root) => {
        const realRoot = fs.realpathSync(root);
        const outsideTest = path.join(
          path.dirname(realRoot),
          `${path.basename(realRoot)}.unit.test.ts`,
        );
        fs.writeFileSync(outsideTest, '// Outside the workspace.\n');
        const result = (
          report.testResults as Array<Record<string, unknown>>
        )[0];
        result.name = outsideTest;
      },
    },
  ];

  for (const candidate of cases) {
    await context.test(candidate.name, async () => {
      const root = fixture();
      try {
        const result = await runVitestCoverage(root, {
          runCommand: async () => {
            writeTestResults(root, 1);
            mutateJsonReport(root, VITEST_RESULTS_REPORT, (report) =>
              candidate.mutate(report, root),
            );
            writeCoverage(root);
            return processResult();
          },
        });

        assert.equal(result.passed, false);
        assert.equal(result.failure, 'invalid_test_results');
        assert.equal(result.testCount, null);
      } finally {
        const realRoot = fs.realpathSync(root);
        fs.rmSync(
          path.join(
            path.dirname(realRoot),
            `${path.basename(realRoot)}.unit.test.ts`,
          ),
          { force: true },
        );
        fs.rmSync(root, { force: true, recursive: true });
      }
    });
  }
});

test('does not accept a green process without valid detailed coverage', async () => {
  const root = fixture();
  try {
    const result = await runVitestCoverage(root, {
      runCommand: async () => {
        writeTestResults(root, 1);
        const target = path.join(root, ...VITEST_COVERAGE_REPORT.split('/'));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, '{}');
        return processResult();
      },
    });

    assert.equal(result.passed, false);
    assert.equal(result.failure, 'invalid_coverage');
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('enforces configured line coverage against detailed zero-hit statements', async () => {
  const root = fixture();
  try {
    const result = await runVitestCoverage(root, {
      minimumLineCoverage: 80,
      runCommand: async () => {
        writeTestResults(root, 1);
        writeCoverage(root);
        const target = path.join(root, ...VITEST_COVERAGE_REPORT.split('/'));
        const coverage = JSON.parse(fs.readFileSync(target, 'utf8')) as Record<
          string,
          { s: Record<string, number> }
        >;
        Object.values(coverage)[0].s['0'] = 0;
        fs.writeFileSync(target, JSON.stringify(coverage));
        return processResult();
      },
    });

    assert.equal(result.passed, false);
    assert.equal(result.failure, 'line_coverage');
    assert.equal(result.lineCoverage, 0);
    assert.match(result.failureMessage || '', /required minimum is 80/);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('rejects empty Istanbul statement maps', async () => {
  const root = fixture();
  try {
    const result = await runVitestCoverage(root, {
      runCommand: async () => {
        writeTestResults(root, 1);
        const target = path.join(root, ...VITEST_COVERAGE_REPORT.split('/'));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(
          target,
          JSON.stringify({
            [path.join(fs.realpathSync(root), 'src', 'example.ts')]: {
              b: {},
              s: {},
              statementMap: {},
            },
          }),
        );
        return processResult();
      },
    });

    assert.equal(result.passed, false);
    assert.equal(result.failure, 'invalid_coverage');
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('rejects mismatched Istanbul branch maps and hit cardinality', async (context) => {
  const cases: Array<{
    branchHits: Record<string, number[]>;
    branchMap: Record<string, unknown>;
    name: string;
  }> = [
    {
      name: 'missing branch hits',
      branchMap: { 0: { locations: [{}, {}], type: 'if' } },
      branchHits: {},
    },
    {
      name: 'missing branch metadata',
      branchMap: {},
      branchHits: { 0: [1, 0] },
    },
    {
      name: 'different branch cardinality',
      branchMap: { 0: { locations: [{}, {}], type: 'if' } },
      branchHits: { 0: [1] },
    },
  ];

  for (const candidate of cases) {
    await context.test(candidate.name, async () => {
      const root = fixture();
      try {
        const result = await runVitestCoverage(root, {
          runCommand: async () => {
            writeTestResults(root, 1);
            writeCoverage(root);
            mutateJsonReport(root, VITEST_COVERAGE_REPORT, (coverage) => {
              const file = Object.values(coverage)[0] as Record<
                string,
                unknown
              >;
              file.branchMap = candidate.branchMap;
              file.b = candidate.branchHits;
            });
            return processResult();
          },
        });

        assert.equal(result.passed, false);
        assert.equal(result.failure, 'invalid_coverage');
        assert.equal(result.branchCoverage, null);
      } finally {
        fs.rmSync(root, { force: true, recursive: true });
      }
    });
  }
});

test('computes branch coverage from matching Istanbul locations and hits', async () => {
  const root = fixture();
  try {
    const result = await runVitestCoverage(root, {
      minimumBranchCoverage: 60,
      runCommand: async () => {
        writeTestResults(root, 1);
        writeCoverage(root);
        mutateJsonReport(root, VITEST_COVERAGE_REPORT, (coverage) => {
          const file = Object.values(coverage)[0] as Record<string, unknown>;
          file.branchMap = {
            0: { locations: [{}, {}], type: 'if' },
          };
          file.b = { 0: [1, 0] };
        });
        return processResult();
      },
    });

    assert.equal(result.passed, false);
    assert.equal(result.failure, 'branch_coverage');
    assert.equal(result.branchCoverage, 50);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('preserves the process failure and timeout as blocking results', async () => {
  const root = fixture();
  try {
    const failed = await runVitestCoverage(root, {
      runCommand: async () => processResult({ code: 2 }),
    });
    assert.equal(failed.passed, false);
    assert.equal(failed.failure, 'test_failure');
    assert.equal(failed.code, 2);

    const timedOut = await runVitestCoverage(root, {
      runCommand: async () => processResult({ code: 1, timedOut: true }),
    });
    assert.equal(timedOut.passed, false);
    assert.equal(timedOut.failure, 'timeout');
    assert.equal(timedOut.timedOut, true);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});
