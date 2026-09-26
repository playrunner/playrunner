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
