import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  evaluateTestPlan,
  validateTestPlan,
  type TestPlan,
} from '../../shared/test-plan';
import { writeTestPlanReport } from './test-plan-report';

const plan: TestPlan = {
  name: 'plan.md',
  markdown: '# Plan\nPreviously PASS\n<script>alert(1)</script>',
  cases: [
    {
      id: 'PASS-1',
      description: 'Both variants',
      criteria: 'Both tests pass',
      tests: [
        { title: 'checks › passes', project: 'desktop' },
        { title: 'checks › passes', project: 'mobile' },
      ],
    },
    {
      id: 'FAIL-1',
      description: 'Failure',
      criteria: 'Test passes',
      tests: [{ title: 'checks › fails', project: 'desktop' }],
    },
    {
      id: 'SKIP-1',
      description: 'Skip',
      criteria: 'Test runs',
      tests: [{ title: 'checks › skipped', project: 'desktop' }],
    },
    {
      id: 'MISSING-1',
      description: 'Missing variant',
      criteria: 'All variants',
      tests: [{ title: 'checks › passes', project: 'missing' }],
    },
    {
      id: 'MANUAL-1',
      description: 'Manual requirement',
      criteria: 'External signoff',
      tests: [],
    },
  ],
};

test('real Playwright results drive plan outcomes, preserve evidence and escape authored Markdown', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-report-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const playwright = require.resolve('@playwright/test');
  fs.writeFileSync(
    path.join(directory, 'checks.spec.cjs'),
    `const { test, expect } = require(${JSON.stringify(playwright)}); test.describe('checks', () => { test('passes', () => expect(1).toBe(1)); test('fails', () => expect(1).toBe(2)); test.skip('skipped', () => {}); });`,
  );
  fs.writeFileSync(
    path.join(directory, 'playwright.config.cjs'),
    `module.exports = { testDir: '.', projects: [{name: 'desktop'}, {name: 'mobile'}], workers: 1, retries: 0 };`,
  );
  const result = spawnSync(
    process.execPath,
    [
      path.join(
        path.dirname(require.resolve('playwright/package.json')),
        'cli.js',
      ),
      'test',
      '--config',
      path.join(directory, 'playwright.config.cjs'),
      '--reporter=json',
    ],
    {
      cwd: directory,
      encoding: 'utf8',
      env: {
        ...process.env,
        PLAYWRIGHT_JSON_OUTPUT_FILE: path.join(directory, 'report.json'),
      },
    },
  );
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(
    fs.readFileSync(path.join(directory, 'report.json'), 'utf8'),
  );
  const evaluated = evaluateTestPlan(plan, report);
  assert.deepEqual(
    evaluated.cases.map((c) => c.status),
    ['PASS', 'FAIL', 'SKIPPED', 'BLOCKED', 'NOT RUN'],
  );
  assert.equal(evaluated.status, 'FAIL');
  assert.equal(evaluated.counts.unmapped, 1);
  assert.equal(
    evaluateTestPlan({ ...plan, cases: [plan.cases[0]] }, report).status,
    'PASS',
  );
  assert.equal(
    evaluateTestPlan({ ...plan, cases: [plan.cases[0], plan.cases[4]] }, report)
      .status,
    'BLOCKED',
  );
  fs.writeFileSync(
    path.join(directory, 'index.html'),
    'original automation report',
  );
  const first = writeTestPlanReport(directory, plan, 'run-1', 'node-1');
  assert.equal(
    fs.readFileSync(path.join(directory, 'automated-tests.html'), 'utf8'),
    'original automation report',
  );
  const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('automated-tests.html#?testId='));
  assert.equal(
    fs.readFileSync(path.join(directory, 'test-plan.md'), 'utf8'),
    plan.markdown,
  );
  const second = writeTestPlanReport(
    directory,
    { ...plan, markdown: 'New plan' },
    'run-2',
    'node-1',
  );
  assert.notEqual(first.version, second.version);
});

test('invalid plans, absent results and global errors never become PASS', () => {
  assert.throws(() => validateTestPlan({ ...plan, name: '../bad.md' }));
  assert.throws(() =>
    validateTestPlan({ ...plan, cases: [plan.cases[0], plan.cases[0]] }),
  );
  assert.throws(() =>
    validateTestPlan({ ...plan, markdown: 'x'.repeat(256 * 1024 + 1) }),
  );
  assert.equal(evaluateTestPlan(plan, {}).status, 'BLOCKED');
  assert.equal(evaluateTestPlan({ ...plan, cases: [] }, {}).status, 'BLOCKED');
});
