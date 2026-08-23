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
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    JSON.stringify({
      numFailedTests: 0,
      numPassedTests: total,
      numTotalTests: total,
      testResults: [],
    }),
  );
}

function writeCoverage(root: string): void {
  const target = path.join(root, ...VITEST_COVERAGE_REPORT.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    JSON.stringify({
      [path.join(root, 'src', 'example.ts')]: {
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

test('runs the container-owned Vitest binary with fixed authoritative arguments', async () => {
  const root = fixture();
  try {
    let invocation:
      | { args: string[]; command: string; config: string; cwd?: string }
      | undefined;
    const result = await runVitestCoverage(root, {
      runCommand: async (command, args, options) => {
        const configIndex = args.indexOf('--config');
        invocation = {
          args,
          command,
          config: fs.readFileSync(args[configIndex + 1], 'utf8'),
          cwd: options.cwd,
        };
        writeTestResults(root, 2);
        writeCoverage(root);
        return processResult();
      },
    });

    assert.equal(invocation?.command, 'vitest');
    assert.equal(invocation?.cwd, fs.realpathSync(root));
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

    assert.equal(result.passed, true, result.failureMessage || result.stderr);
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
