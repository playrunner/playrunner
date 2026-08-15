import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWorkflowHistory } from './workflow-history';

test('builds compact redacted logs and sharding diagnostics', () => {
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

  assert.equal(history.runs[0]?.logs.length, 1);
  assert.equal(
    history.runs[0]?.logs[0]?.message,
    'Authorization: Bearer [redacted]',
  );
  assert.equal(history.runs[0]?.logs[0]?.level, 'error');
  assert.equal(history.runs[0]?.durationMs, 60_000);
  assert.deepEqual(history.runs[0]?.diagnostics.sharding, [{ shardCount: 4 }]);
  assert.equal(Object.hasOwn(history, 'logs'), false);
});

test('keeps the lazy history response within its byte budget', () => {
  const executions = Array.from({ length: 8 }, (_, runIndex) => ({
    cloudProvider: 'LOCAL_RUNNER',
    completedAt: new Date('2026-08-14T00:01:00.000Z'),
    events: Array.from({ length: 150 }, (_, eventIndex) => ({
      executionId: `run-${runIndex}`,
      level: 'info',
      message: `log-${eventIndex}-${'x'.repeat(10_000)}`,
      nodeId: 'playwright-1',
      occurredAt: new Date('2026-08-14T00:00:30.000Z'),
      payload: {},
      type: 'log',
    })),
    id: `run-${runIndex}`,
    startedAt: new Date('2026-08-14T00:00:00.000Z'),
    status: 'failed',
  }));

  const history = buildWorkflowHistory(executions);

  assert.ok(Buffer.byteLength(JSON.stringify(history), 'utf8') <= 256 * 1024);
  assert.ok(history.runs.length <= 10);
  assert.ok(history.runs.every((run) => run.logs.length <= 100));
});

test('retains sharding observations after the per-run log limit', () => {
  const history = buildWorkflowHistory([
    {
      cloudProvider: 'GCP',
      completedAt: new Date('2026-08-14T00:01:00.000Z'),
      events: [
        ...Array.from({ length: 150 }, (_, eventIndex) => ({
          executionId: 'run-noisy',
          level: 'info',
          message: `log-${eventIndex}`,
          nodeId: 'playwright-1',
          occurredAt: new Date('2026-08-14T00:00:30.000Z'),
          payload: {},
          type: 'log',
        })),
        {
          executionId: 'run-noisy',
          level: null,
          message: null,
          nodeId: 'playwright-1',
          occurredAt: new Date('2026-08-14T00:00:59.000Z'),
          payload: {
            blobReportsComplete: true,
            completed: true,
            nodeId: 'playwright-1',
            type: 'playwright_execution_observation',
          },
          type: 'playwright_execution_observation',
        },
      ],
      id: 'run-noisy',
      startedAt: new Date('2026-08-14T00:00:00.000Z'),
      status: 'completed',
    },
  ]);

  assert.equal(history.runs[0]?.logs.length, 100);
  assert.deepEqual(history.runs[0]?.diagnostics.sharding, [
    {
      blobReportsComplete: true,
      completed: true,
      nodeId: 'playwright-1',
      type: 'playwright_execution_observation',
    },
  ]);
});

test('retains ten run observations when logs exceed the response budget', () => {
  const executions = Array.from({ length: 10 }, (_, runIndex) => ({
    cloudProvider: 'GCP',
    completedAt: new Date('2026-08-14T00:01:00.000Z'),
    events: [
      ...Array.from({ length: 100 }, (_, eventIndex) => ({
        executionId: `run-${runIndex}`,
        level: 'info',
        message: `log-${eventIndex}-${'x'.repeat(2_000)}`,
        nodeId: 'playwright-1',
        occurredAt: new Date('2026-08-14T00:00:30.000Z'),
        payload: {},
        type: 'log',
      })),
      {
        executionId: `run-${runIndex}`,
        level: null,
        message: null,
        nodeId: 'playwright-1',
        occurredAt: new Date('2026-08-14T00:00:59.000Z'),
        payload: {
          nodeId: 'playwright-1',
          type: 'playwright_execution_observation',
        },
        type: 'playwright_execution_observation',
      },
    ],
    id: `run-${runIndex}`,
    startedAt: new Date('2026-08-14T00:00:00.000Z'),
    status: 'completed',
  }));

  const history = buildWorkflowHistory(executions);

  assert.equal(history.runs.length, 10);
  assert.ok(Buffer.byteLength(JSON.stringify(history), 'utf8') <= 256 * 1024);
  assert.ok(history.runs.every((run) => run.diagnostics.sharding.length === 1));
});
