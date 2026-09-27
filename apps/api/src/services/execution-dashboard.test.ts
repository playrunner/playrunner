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

test('keeps workflow order and groups discovery, numeric shards and aggregate under each test', () => {
  const child = (
    id: number,
    parentNodeId: string,
    childKind: string,
    shardIndex?: number,
  ) =>
    event(
      id,
      'node_state',
      { state: 'pending', parentNodeId, childKind, shardIndex },
      `${parentNodeId}--${childKind}${shardIndex ?? ''}`,
    );
  const execution = {
    id: 'run',
    workflowId: null,
    status: 'running',
    cloudProvider: 'LOCAL_RUNNER',
    startedAt: time,
    completedAt: null,
    events: [
      event(
        1,
        'execution_definition',
        {
          nodes: [
            { id: 'env', title: 'Environment', type: 'environment' },
            { id: 'desktop', title: 'Desktop UI', type: 'playwright' },
            { id: 'fixtures', title: 'Fixture cases', type: 'playwright' },
          ],
        },
        null,
      ),
      // Events can arrive interleaved and out of shard order.
      child(2, 'fixtures', 'shard', 2),
      child(3, 'desktop', 'aggregate'),
      child(4, 'desktop', 'shard', 10),
      child(5, 'desktop', 'shard', 2),
      child(6, 'desktop', 'discovery'),
      child(7, 'desktop', 'shard', 1),
      child(8, 'fixtures', 'discovery'),
      child(9, 'fixtures', 'shard', 1),
      // Later runner events omit the ordering metadata.
      event(10, 'node_state', { state: 'success' }, 'desktop--shard2'),
      event(
        11,
        'node_output',
        { output: { reportUrl: '/outputs/run/desktop/report.html' } },
        'desktop--aggregate',
      ),
    ],
  };
  const expected = [
    'env',
    'desktop',
    'desktop--discovery',
    'desktop--shard1',
    'desktop--shard2',
    'desktop--shard10',
    'desktop--aggregate',
    'fixtures',
    'fixtures--discovery',
    'fixtures--shard1',
    'fixtures--shard2',
  ];
  const result = projectExecution(execution);
  assert.deepEqual(
    result.nodes.map((node) => node.id),
    expected,
  );
  assert.equal(result.nodes[4].status, 'succeeded');
  assert.equal(result.nodes[6].reportUrl, '/outputs/run/desktop/report.html');
  assert.deepEqual(
    projectExecution({
      ...execution,
      events: [...execution.events].reverse(),
    }).nodes,
    result.nodes,
  );
  assert.deepEqual(
    projectExecution({
      ...execution,
      events: [...execution.events, child(12, 'fixtures', 'aggregate')],
    }).nodes.map((node) => node.id),
    [...expected, 'fixtures--aggregate'],
  );
});

test('retains unparented, orphaned and cyclic runtime nodes exactly once', () => {
  const result = projectExecution({
    id: 'run',
    workflowId: null,
    status: 'running',
    cloudProvider: 'LOCAL_RUNNER',
    startedAt: time,
    completedAt: null,
    events: [
      event(1, 'node_state', { state: 'running' }, 'plain'),
      event(2, 'node_state', { parentNodeId: 'missing' }, 'orphan'),
      event(3, 'node_state', { parentNodeId: 'b' }, 'a'),
      event(4, 'node_state', { parentNodeId: 'a' }, 'b'),
      event(5, 'node_state', { parentNodeId: 'self' }, 'self'),
    ],
  });
  assert.deepEqual(
    result.nodes.map((node) => node.id),
    ['plain', 'orphan', 'a', 'b', 'self'],
  );
});

test('rolls up shard counts once and preserves valid parent relationships', () => {
  const progress = (total: number, completed: number) => ({
    total,
    completed,
    passed: completed,
    failed: 0,
    skipped: 0,
    running: 1,
  });
  const result = projectExecution({
    id: 'run',
    workflowId: null,
    status: 'running',
    cloudProvider: 'LOCAL_RUNNER',
    startedAt: time,
    completedAt: null,
    events: [
      event(
        1,
        'execution_definition',
        {
          nodes: [
            { id: 'parent', title: 'Fixture cases', type: 'playwright' },
            { id: 'other', title: 'Other suite', type: 'playwright' },
          ],
        },
        null,
      ),
      event(2, 'test_progress', { progress: progress(462, 0) }, 'parent'),
      event(
        3,
        'node_state',
        { state: 'running', parentNodeId: 'parent', childKind: 'shard' },
        'one',
      ),
      event(4, 'test_progress', { progress: progress(236, 53) }, 'one'),
      event(
        5,
        'node_state',
        { state: 'running', parentNodeId: 'parent', childKind: 'shard' },
        'two',
      ),
      event(6, 'test_progress', { progress: progress(226, 47) }, 'two'),
      event(
        7,
        'test_progress',
        {
          parentNodeId: 'parent',
          childKind: 'discovery',
          progress: progress(462, 0),
        },
        'discovery',
      ),
      event(
        8,
        'test_progress',
        {
          parentNodeId: 'parent',
          childKind: 'aggregate',
          progress: progress(462, 0),
        },
        'aggregate',
      ),
      event(9, 'test_progress', { progress: progress(10, 2) }, 'other'),
    ],
  });
  const parent = result.nodes.find((node) => node.id === 'parent')!;
  assert.equal(parent.parentNodeId, null);
  assert.equal(parent.status, 'running');
  assert.deepEqual(parent.progress, {
    total: 462,
    completed: 100,
    passed: 100,
    failed: 0,
    skipped: 0,
    running: 2,
  });
  assert.equal(
    result.nodes.find((node) => node.id === 'one')?.parentNodeId,
    'parent',
  );
  assert.deepEqual(
    result.nodes.find((node) => node.id === 'other')?.progress,
    progress(10, 2),
  );
});

test('breaks parent cycles and rolls nested progress up without double counting', () => {
  const progress = {
    total: 4,
    completed: 3,
    passed: 1,
    failed: 1,
    skipped: 1,
    running: 1,
  };
  const result = projectExecution({
    id: 'run',
    workflowId: null,
    status: 'running',
    cloudProvider: 'LOCAL_RUNNER',
    startedAt: time,
    completedAt: null,
    events: [
      event(1, 'node_state', { parentNodeId: 'b' }, 'a'),
      event(2, 'node_state', { parentNodeId: 'a' }, 'b'),
      event(3, 'test_progress', { parentNodeId: 'b', progress }, 'c'),
      event(4, 'node_state', { parentNodeId: 'missing' }, 'orphan'),
      event(5, 'node_state', { parentNodeId: 'self' }, 'self'),
    ],
  });
  assert.deepEqual(
    result.nodes.map((node) => [node.id, node.parentNodeId]),
    [
      ['orphan', null],
      ['a', null],
      ['b', 'a'],
      ['c', 'b'],
      ['self', null],
    ],
  );
  for (const node of result.nodes.filter((node) =>
    ['a', 'b', 'c'].includes(node.id),
  ))
    assert.deepEqual(node.progress, progress);
});
