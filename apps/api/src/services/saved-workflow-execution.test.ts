import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request } from 'express';
import { executeSavedWorkflow } from './saved-workflow-execution';

test('rechecks the trusted-push policy on the exact workflow row being executed', async () => {
  let executed = false;
  const started = await executeSavedWorkflow(
    {
      executionId: 'execution-1',
      req: {} as Request,
      trigger: {
        data: { eventType: 'pull_request' },
        name: 'ci',
      },
      userId: 'user-1',
      workflowId: 'workflow-1',
    },
    {
      executeWorkflow: async () => {
        executed = true;
        return { body: {}, status: 200 };
      },
      findWorkflow: async () => ({
        cloudProvider: 'LOCAL_RUNNER',
        concurrency: null,
        connections: [],
        id: 'workflow-1',
        nodes: [{ id: 'agent', nodeType: 'agent-container' }],
        title: 'Changed workflow',
        userId: 'user-1',
      }),
    },
  );

  assert.equal(executed, false);
  assert.equal(started?.result.status, 400);
  assert.match(String(started?.result.body.error), /trusted source push/);
});
