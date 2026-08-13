import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWorkflowHistory } from './workflow-history';

test('builds redacted, level-filtered logs and sharding diagnostics', () => {
  const history = buildWorkflowHistory([
    {
      cloudProvider: 'LOCAL_RUNNER',
      completedAt: new Date('2026-08-14T00:01:00.000Z'),
      events: [
        {
          executionId: 'run-1',
          level: 'error',
          message: 'Authorization: Bearer secret-token-value',
          nodeId: 'playwright-1',
          occurredAt: new Date('2026-08-14T00:00:30.000Z'),
          payload: {},
          type: 'log',
        },
        {
          executionId: 'run-1',
          level: 'info',
          message: null,
          nodeId: 'playwright-1',
          occurredAt: new Date('2026-08-14T00:00:10.000Z'),
          payload: { shardCount: 4 },
          type: 'playwright_execution_observation',
        },
      ],
      id: 'run-1',
      startedAt: new Date('2026-08-14T00:00:00.000Z'),
      status: 'failed',
    },
  ]);

  assert.equal(history.logs.error.length, 1);
  assert.equal(
    history.logs.error[0]?.message,
    'Authorization: Bearer [redacted]',
  );
  assert.equal(history.runs[0]?.durationMs, 60_000);
  assert.deepEqual(history.runs[0]?.diagnostics.sharding, [{ shardCount: 4 }]);
});
