import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { evaluateTestPlan, readTests } from '../../shared/test-plan';
import { readPlaywrightReportData } from './report-data';

const report = {
  suites: [
    {
      specs: [
        {
          id: 'known-defect',
          title: 'country is saved',
          file: 'account.spec.ts',
          tests: [
            {
              projectName: 'chromium',
              expectedStatus: 'failed',
              status: 'expected',
              results: [
                {
                  status: 'failed',
                  retry: 0,
                  errors: [{ message: 'Known country selection defect' }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

test('known expected failures retain FAIL for release gates while carrying alert metadata', () => {
  assert.deepEqual(readTests(report), [
    {
      title: 'country is saved',
      project: 'chromium',
      status: 'FAIL',
      evidenceId: 'known-defect',
      expectedFailure: true,
    },
  ]);
  const evaluated = evaluateTestPlan(
    {
      name: 'plan.md',
      markdown: '# Plan',
      cases: [
        {
          id: 'COUNTRY',
          description: 'Country selection',
          criteria: 'Country is saved',
          tests: [{ title: 'country is saved', project: 'chromium' }],
        },
      ],
    },
    report,
  );
  assert.equal(evaluated.cases[0].status, 'FAIL');
  const unexpected = structuredClone(report);
  unexpected.suites[0].specs[0].tests[0].status = 'unexpected';
  assert.equal(readTests(unexpected)[0].expectedFailure, undefined);
});

test('runner summaries preserve expected-failure metadata and matching evidence identity', () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'playrunner-known-failure-'),
  );
  try {
    const reportPath = path.join(directory, 'report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report));
    const summary = readPlaywrightReportData({
      reportPath,
      workingDir: directory,
      testId: 'run',
      nodeId: 'node',
    });
    assert.equal(summary?.planTests?.[0].status, 'FAIL');
    assert.equal(summary?.planTests?.[0].expectedFailure, true);
    assert.equal(
      summary?.failures[0].evidenceId,
      summary?.planTests?.[0].evidenceId,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
