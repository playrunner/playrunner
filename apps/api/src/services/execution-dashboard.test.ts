import assert from 'node:assert/strict';
import test from 'node:test';
import { projectExecution } from './execution-dashboard';

const time = new Date('2026-01-01T00:00:00Z');
const event = (
  id: number,
  type: string,
  payload: unknown,
  nodeId: string | null = 'n',
) => ({
  id: BigInt(id),
  type,
  payload,
  nodeId,
  occurredAt: new Date(time.getTime() + id * 1000),
  createdAt: time,
});

test('flags silent runs without inventing a terminal outcome and recovers on any new event', () => {
  const execution = {
    id: 'old-run',
    workflowId: null,
    status: 'running',
    cloudProvider: 'LOCAL_RUNNER',
    startedAt: time,
    completedAt: null,
    events: [event(1, 'node_state', { state: 'running' })],
  };
  const now = time.getTime() + 10 * 60 * 1000;
  const stale = projectExecution(execution, undefined, now);
  assert.equal(stale.activityStale, true);
  assert.equal(stale.status, 'running');
  assert.equal(stale.completedAt, null);
  assert.equal(stale.lastActivityAt, time.toISOString());
  assert.equal(stale.nodes[0].status, 'running');

  const logging = projectExecution(
    { ...execution, lastEventAt: new Date(now - 1000) },
    undefined,
    now,
  );
  assert.equal(logging.activityStale, false);
  assert.equal(logging.lastActivityAt, new Date(now - 1000).toISOString());
  assert.equal(
    projectExecution({ ...execution, status: 'failed' }, undefined, now)
      .activityStale,
    false,
  );
  assert.equal(
    projectExecution({ ...execution, events: [] }, undefined, now)
      .activityStale,
    true,
  );
});
test('snapshot recovers nodes and outcomes without exposing configuration or regressing terminal states', () => {
  const result = projectExecution({
    id: 'run',
    workflowId: 'workflow',
    status: 'running',
    cloudProvider: 'LOCAL_RUNNER',
    startedAt: time,
    completedAt: null,
    events: [
      event(
        1,
        'execution_definition',
        {
          title: 'Original workflow',
          nodes: [
            { id: 'n', title: 'Check', type: 'playwright' },
            { id: 'waiting', title: 'Waiting', type: 'javascript' },
          ],
        },
        null,
      ),
      event(2, 'node_state', { state: 'success', secret: 'never return' }),
      event(3, 'node_state', { state: 'running' }),
      event(4, 'node_output', {
        output: { reportUrl: 'https://evil.example' },
      }),
      event(5, 'workflow_failed', {}, null),
      event(6, 'workflow_completed', {}, null),
    ],
  });
  assert.equal(result.title, 'Original workflow');
  assert.equal(result.status, 'failed');
  assert.equal(result.nodes[0].status, 'succeeded');
  assert.equal(result.nodes[1].status, 'pending');
  assert.equal(result.nodes[0].reportUrl, null);
  assert.ok(!JSON.stringify(result).includes('secret'));
});

test('projects structured progress and ignores malformed counts and extra fields', () => {
  const progress = {
    total: 10,
    completed: 4,
    passed: 3,
    failed: 1,
    skipped: 0,
    running: 2,
  };
  const result = projectExecution({
    id: 'run',
    workflowId: null,
    status: 'running',
    cloudProvider: 'LOCAL_RUNNER',
    startedAt: time,
    completedAt: null,
    events: [
      event(1, 'test_progress', {
        progress: { ...progress, secret: 'do not expose' },
      }),
      event(2, 'test_progress', { progress: { ...progress, completed: 99 } }),
    ],
  });
  assert.deepEqual(result.nodes[0].progress, progress);
});
