import assert from 'node:assert/strict';
import test from 'node:test';
import {
  feedbackArtifactPath,
  parseFeedbackCursor,
  projectMachineFeedback,
  type FeedbackEvent,
} from './machine-feedback';

const time = new Date('2026-10-18T00:00:00Z');
const execution = {
  id: 'run',
  workflowId: 'workflow',
  status: 'completed',
  cloudProvider: 'LOCAL_RUNNER',
  startedAt: time,
  completedAt: time,
};
const event = (
  id: number,
  type: string,
  payload: unknown,
  nodeId: string | null = 'checkout',
): FeedbackEvent => ({
  id: BigInt(id),
  type,
  payload,
  nodeId,
  createdAt: time,
  occurredAt: time,
});
const plan = {
  version: 1,
  requestedMode: 'affected',
  mode: 'affected',
  hash: 'a'.repeat(64),
  policyHash: 'b'.repeat(64),
  sources: [
    {
      repository: 'example/shop',
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
    },
  ],
  changedFiles: [{ repository: 'example/shop', path: 'src/cart.ts' }],
  tests: [{ file: 'tests/checkout.spec.ts', project: 'chromium' }],
  journeys: [
    {
      id: 'checkout',
      title: 'Checkout',
      tests: [{ file: 'tests/checkout.spec.ts', project: 'chromium' }],
      reasons: [
        { changed: { repository: 'example/shop', path: 'src/cart.ts' } },
      ],
    },
  ],
  fallbackReasons: [],
};
const project = (events: FeedbackEvent[], rest = {}) =>
  projectMachineFeedback({
    execution,
    snapshotEvents: events,
    pageEvents: events,
    after: 0n,
    ...rest,
  });

test('feedback exposes final failures and selected journeys, not a passing retry or untrusted report fields', () => {
  const result = project([
    event(
      1,
      'execution_definition',
      {
        title: 'Tests',
        nodes: [{ id: 'checkout', title: 'Checkout', type: 'playwright' }],
      },
      null,
    ),
    event(2, 'regression_plan', {
      plan,
      discovery: { status: 'ready', testCount: 2 },
    }),
    event(3, 'test_progress', {
      progress: {
        total: 2,
        completed: 2,
        passed: 1,
        failed: 1,
        skipped: 0,
        running: 0,
      },
    }),
    event(4, 'node_output', {
      output: {
        reportUrl: '/outputs/run/checkout/playwright-report/index.html',
        reportDataUrl: 'https://attacker.example/report',
        secret: 'not-for-the-agent',
        report: {
          planTests: [
            {
              evidenceId: 'retried',
              title: 'checkout › can add to cart',
              project: 'chromium',
              status: 'PASS',
            },
            {
              evidenceId: 'failed',
              title: 'checkout › payment appears',
              project: 'chromium',
              status: 'FAIL',
            },
          ],
          failures: [
            {
              evidenceId: 'retried',
              projectName: 'chromium',
              title: 'can add to cart',
              errors: [{ message: 'An earlier retry failed.' }],
            },
            {
              evidenceId: 'failed',
              projectName: 'chromium',
              title: 'payment appears',
              location: { file: 'tests/checkout.spec.ts' },
              errors: [
                {
                  message:
                    'password=do-not-print\nExpected payment confirmation.',
                },
              ],
              attachments: [
                { url: '/outputs/run/checkout/trace.zip' },
                { url: '/outputs/other/trace.zip' },
              ],
            },
          ],
        },
      },
    }),
  ]);
  assert.equal(result.failureCount, 1);
  assert.equal(result.failures[0].title, 'checkout › payment appears');
  assert.deepEqual(result.failures[0].journeyIds, ['checkout']);
  assert.deepEqual(result.failures[0].artifacts, [
    '/outputs/run/checkout/trace.zip',
  ]);
  assert.match(String(result.failures[0].error), /password=\[redacted\]/);
  assert.doesNotMatch(
    JSON.stringify(result),
    /do-not-print|not-for-the-agent|attacker|An earlier retry/,
  );
  assert.equal(result.progress?.failed, 1);
  assert.equal(result.nodes[0].plan?.mode, 'affected');
  assert.equal(result.regressionConclusion, 'not_evaluated');
});

test('feedback pages advance over exactly the returned changes and can resume without repetition', () => {
  const events = Array.from({ length: 101 }, (_, i) =>
    event(i + 1, 'node_state', { state: 'running' }),
  );
  const first = project(events);
  assert.equal(first.changes.length, 100);
  assert.equal(first.nextCursor, '100');
  assert.equal(first.hasMore, true);
  const second = project(events, {
    after: 100n,
    pageEvents: events.slice(100),
  });
  assert.equal(second.changes[0].sequence, '101');
  assert.equal(second.nextCursor, '101');
  assert.equal(second.hasMore, false);
  assert.equal(
    project(events, { after: 101n, pageEvents: [] }).nextCursor,
    '101',
  );
});

test('a final-attempt failure is actionable before node completion and the final report supersedes live IDs', () => {
  const events = [
    event(1, 'regression_plan', { plan }),
    event(2, 'test_result', {
      test: {
        evidenceId: 'live-id',
        title: 'Payment confirmation',
        project: 'firefox',
        file: 'tests/checkout.spec.ts',
        status: 'failed',
        retry: 2,
        duration: 100,
      },
    }),
  ];
  const live = project(events, {
    execution: { ...execution, status: 'running', completedAt: null },
  });
  assert.equal(live.status, 'running');
  assert.deepEqual(live.failures[0].journeyIds, ['checkout']);
  assert.equal(live.changes[1].test?.status, 'failed');
  assert.equal(live.regressionConclusion, 'not_evaluated');
  const final = project([
    ...events,
    event(3, 'node_output', {
      output: {
        report: {
          planTests: [
            {
              evidenceId: 'report-id',
              title: 'Payment confirmation',
              project: 'firefox',
              status: 'PASS',
            },
          ],
        },
      },
    }),
  ]);
  assert.equal(final.failureCount, 0);
  assert.deepEqual(final.failures, []);
});

test('feedback uses parent shard rollups once and avoids repeating a merged failure', () => {
  const report = {
    planTests: [
      {
        evidenceId: 'f',
        title: 'failure',
        project: 'chromium',
        status: 'FAIL',
      },
    ],
  };
  const progress = {
    total: 1,
    completed: 1,
    passed: 0,
    failed: 1,
    skipped: 0,
    running: 0,
  };
  const result = project([
    event(
      1,
      'execution_definition',
      { nodes: [{ id: 'parent', title: 'Suite', type: 'playwright' }] },
      null,
    ),
    event(
      2,
      'test_progress',
      { progress, parentNodeId: 'parent', childKind: 'shard', shardIndex: 1 },
      'child',
    ),
    event(3, 'node_output', { output: { report } }, 'child'),
    event(4, 'node_output', { output: { report } }, 'parent'),
  ]);
  assert.equal(result.progress?.total, 1);
  assert.equal(result.failureCount, 1);
  assert.equal(result.failures[0].nodeId, 'parent');
});

test('configured expected failures remain explicit issues when a final report replaces the live outcome', () => {
  const liveEvents = [
    event(1, 'test_result', {
      test: {
        evidenceId: 'live-known',
        title: 'Known checkout bug',
        project: 'chromium',
        file: 'tests/checkout.spec.ts',
        status: 'passed',
        expectedFailure: true,
        retry: 0,
        duration: 20,
      },
    }),
  ];
  const live = project(liveEvents, {
    execution: { ...execution, status: 'running', completedAt: null },
  });
  assert.equal(live.failureCount, 0);
  assert.equal(live.expectedFailureCount, 1);
  assert.match(
    live.issues[0].message,
    /Failure expected by test configuration/,
  );
  const expected = {
    evidenceId: 'report-known',
    title: 'Known checkout bug',
    project: 'chromium',
    status: 'FAIL',
    expectedFailure: true,
  };
  const final = project([
    ...liveEvents,
    event(2, 'node_output', {
      output: {
        report: {
          planTests: [expected],
          failures: [
            {
              evidenceId: 'report-known',
              title: 'Known checkout bug',
              projectName: 'chromium',
            },
          ],
        },
      },
    }),
  ]);
  assert.equal(expected.status, 'FAIL');
  assert.equal(final.failureCount, 0);
  assert.deepEqual(final.failures, []);
  assert.equal(final.expectedFailureCount, 1);
  assert.match(
    final.issues[0].message,
    /does not establish a baseline, a new failure alert or passing release evidence/,
  );
  assert.equal(final.regressionConclusion, 'not_evaluated');
});

test('missing or truncated final evidence never converts retry details into established failures', () => {
  const result = project(
    [
      event(1, 'node_output', {
        output: {
          report: {
            failures: [{ title: 'maybe retried' }],
            truncation: { truncated: true },
          },
        },
      }),
    ],
    { snapshotTruncated: true },
  );
  assert.equal(result.evidenceIncomplete, true);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.failures, []);
  assert.equal(result.regressionConclusion, 'not_evaluated');
});

test('feedback reports blocked discovery and global errors without inventing a test failure', () => {
  const result = project([
    event(1, 'regression_plan', {
      plan: { ...plan, mode: 'full', fallbackReasons: ['Unmapped change.'] },
      discovery: {
        status: 'blocked',
        testCount: 0,
        blockReason: 'No tests discovered.',
      },
    }),
    event(2, 'node_output', {
      output: {
        report: {
          planTests: [],
          errors: [{ message: 'Configuration could not be loaded.' }],
        },
      },
    }),
  ]);
  assert.equal(result.nodes[0].discovery?.status, 'blocked');
  assert.equal(result.nodes[0].discovery?.reason, 'No tests discovered.');
  assert.equal(result.issues[0].message, 'Configuration could not be loaded.');
  assert.equal(result.failureCount, 0);
  assert.equal(result.evidenceIncomplete, true);
});

test('upstream plan truncation survives projection and totals include omitted entries', () => {
  const result = project([
    event(1, 'regression_plan', {
      plan: {
        ...plan,
        truncation: {
          changedFilesOmitted: 20,
          journeysOmitted: 3,
          reasonsOmitted: 7,
          testsOmitted: 10,
        },
      },
    }),
  ]);
  const captured = result.nodes[0].plan!;
  assert.equal(captured.changedFileCount, 21);
  assert.equal(captured.selectedJourneyCount, 4);
  assert.equal(captured.selectedTestFileCount, 11);
  assert.equal(captured.truncation.reasonsOmitted, 7);
  assert.equal(captured.truncated, true);
  assert.equal(result.truncated, true);
});

test('successful node lifecycle without a final Playwright report is incomplete evidence', () => {
  const result = project([
    event(
      1,
      'execution_definition',
      { nodes: [{ id: 'checkout', title: 'Checkout', type: 'playwright' }] },
      null,
    ),
    event(2, 'node_state', { state: 'success' }),
  ]);
  assert.equal(result.status, 'completed');
  assert.equal(result.nodes[0].status, 'succeeded');
  assert.equal(result.evidenceIncomplete, true);
});

test('artifact paths cannot escape the authorized execution', () => {
  for (const path of [
    '/outputs/other/report.html',
    '/outputs/run/../secret',
    '/outputs/run/%2e%2e/secret',
    '/outputs/run/%252e%252e/secret',
    '/outputs/run/file?token=x',
    '/outputs/run/file%3Ftoken=x',
    'https://example.com/outputs/run/report',
    '/outputs/run/x\\..\\secret',
  ]) {
    assert.equal(feedbackArtifactPath(path, 'run'), null, path);
  }
  assert.equal(
    feedbackArtifactPath('/outputs/run/checkout/report%20one.html', 'run'),
    '/outputs/run/checkout/report%20one.html',
  );
});

test('cursor validation rejects negative, fractional, oversized and ambiguous values', () => {
  assert.equal(parseFeedbackCursor(undefined), 0n);
  assert.equal(parseFeedbackCursor('42'), 42n);
  for (const cursor of [
    '-1',
    '1.1',
    '1e2',
    ['1'],
    '9223372036854775808',
    '9'.repeat(100),
  ])
    assert.throws(() => parseFeedbackCursor(cursor));
});

test('large mappings produce explicitly truncated bounded tool context', () => {
  const hugePlan = {
    ...plan,
    journeys: Array.from({ length: 100 }, (_, index) => ({
      ...plan.journeys[0],
      id: `journey-${index}`,
      title: 'x'.repeat(200),
      tests: Array.from({ length: 100 }, (_, i) => ({
        file: `${'a'.repeat(400)}/${i}.spec.ts`,
      })),
    })),
  };
  const result = project([event(1, 'regression_plan', { plan: hugePlan })]);
  assert.equal(result.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 128 * 1024);
});
