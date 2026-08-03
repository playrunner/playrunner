import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSavedWorkflowExecutionBody } from './saved-workflow-payload';

test('saved workflow executions publish events under the API execution ID', () => {
  const body = buildSavedWorkflowExecutionBody({
    body: {
      cloudProvider: 'GCP',
      nodes: ['untrusted override'],
      testId: 'untrusted override',
    },
    executionId: 'execution-123',
    triggerData: {},
    triggerName: 'ci',
    workflow: {
      cloudProvider: 'LOCAL_RUNNER',
      concurrency: 1,
      connections: [{ sourceId: 'a', targetId: 'b' }],
      id: 'workflow-123',
      nodes: [{ id: 'a' }, { id: 'b' }],
      title: 'CI workflow',
    },
  });

  assert.equal(body.testId, 'execution-123');
  assert.equal(body.cloudProvider, 'LOCAL_RUNNER');
  assert.deepEqual(body.nodes, [{ id: 'a' }, { id: 'b' }]);
  assert.equal(body.workflow.run.trigger, 'ci');
});

test('saved workflow executions preserve registered cloud providers', () => {
  const body = buildSavedWorkflowExecutionBody({
    executionId: 'execution-456',
    triggerData: {},
    triggerName: 'ci',
    workflow: {
      cloudProvider: 'PLAYRUNNER_CLOUD',
      concurrency: null,
      connections: [],
      id: 'workflow-456',
      nodes: [],
      title: 'Hosted workflow',
    },
  });

  assert.equal(body.cloudProvider, 'PLAYRUNNER_CLOUD');
  assert.equal(body.workflow.run.runner, 'PLAYRUNNER_CLOUD');
});
