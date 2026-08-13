import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readPlaywrightReportData } from './report-data';

test('extracts model-ready failure data and artifact URLs', () => {
  const workingDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'playrunner-report-'),
  );
  const reportPath = path.join(workingDir, 'playwright-report', 'report.json');
  const screenshotPath = path.join(
    workingDir,
    'test-results',
    'checkout',
    'failure.png',
  );
  const errorContextPath = path.join(
    workingDir,
    'test-results',
    'checkout',
    'error-context.md',
  );
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  fs.writeFileSync(screenshotPath, 'image');
  fs.writeFileSync(errorContextPath, '# Page snapshot\n\nCheckout failed.');
  fs.writeFileSync(
    reportPath,
    JSON.stringify({
      errors: [{ message: 'global setup failed' }],
      stats: { expected: 0, unexpected: 1 },
      suites: [
        {
          suites: [
            {
              specs: [
                {
                  file: 'checkout.spec.ts',
                  line: 12,
                  title: 'submits an order',
                  tests: [
                    {
                      projectName: 'chromium',
                      results: [
                        {
                          attachments: [
                            {
                              contentType: 'image/png',
                              name: 'screenshot',
                              path: screenshotPath,
                            },
                          ],
                          duration: 215,
                          errors: [{ message: 'Expected total to be $10' }],
                          retry: 1,
                          status: 'failed',
                          stderr: ['browser error'],
                          stdout: ['request completed'],
                          steps: [{ title: 'expect total' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
  );

  try {
    const report = readPlaywrightReportData({
      nodeId: 'node-1',
      reportPath,
      testId: 'execution-1',
      workingDir,
    });

    assert.equal(report?.failures.length, 1);
    assert.equal(report?.failures[0].title, 'submits an order — chromium');
    assert.deepEqual(report?.failures[0].errors[0], {
      message: 'Expected total to be $10',
    });
    assert.equal(
      report?.failures[0].attachments[0].url,
      '/outputs/execution-1/node-1/test-results/checkout/failure.png',
    );
    assert.deepEqual(report?.stats, { expected: 0, unexpected: 1 });
    assert.deepEqual(report?.errorContexts, [
      {
        path: 'test-results/checkout/error-context.md',
        text: '# Page snapshot\n\nCheckout failed.',
        url: '/outputs/execution-1/node-1/test-results/checkout/error-context.md',
      },
    ]);
  } finally {
    fs.rmSync(workingDir, { force: true, recursive: true });
  }
});
