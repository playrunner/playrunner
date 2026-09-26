import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWorkflowPlanReport } from './workflow-test-plan';
import { captureExecutionDefinition } from './execution-definition';

const now = new Date();
const plan = {
  name: 'workflow.md',
  markdown: '# Previously PASS',
  cases: [
    {
      id: 'CASE-1',
      description: 'Across both suites and an action',
      criteria: 'Both suites and publishing must succeed',
      tests: [
        { nodeId: 'a', title: 'same title', project: 'desktop' },
        { nodeId: 'b', title: 'same title', project: 'desktop' },
      ],
      nodes: ['publish'],
    },
  ],
};
const definition = captureExecutionDefinition({
  workflow: { definition: { name: 'Regression', testPlan: plan } },
  nodes: [
    { id: 'a', nodeType: 'playwright' },
    { id: 'b', nodeType: 'playwright' },
    { id: 'publish', nodeType: 'code' },
  ],
});
const event = (
  id: number,
  type: string,
  payload: unknown,
  nodeId: string | null = null,
) => ({
  id: BigInt(id),
  type,
  payload,
  nodeId,
  createdAt: now,
  occurredAt: now,
});
const execution = {
  id: 'run',
  workflowId: 'workflow',
  status: 'completed',
  cloudProvider: 'LOCAL_RUNNER',
  startedAt: now,
  completedAt: now,
  events: [
    event(1, 'execution_definition', definition),
    event(2, 'node_state', { state: 'success' }, 'a'),
    event(3, 'node_state', { state: 'success' }, 'b'),
    event(4, 'node_state', { state: 'success' }, 'publish'),
    ...['a', 'b'].map((nodeId, index) =>
      event(
        5 + index,
        'node_output',
        {
          output: {
            report: {
              planTests: [
                {
                  title: 'same title',
                  project: 'desktop',
                  status: 'PASS',
                  evidenceId: nodeId,
                },
              ],
            },
          },
        },
        nodeId,
      ),
    ),
  ],
};

test('one captured plan requires evidence across multiple suites and action nodes', () => {
  const result = buildWorkflowPlanReport(execution)!;
  assert.equal(result.status, 'PASS');
  assert.equal(result.cases[0].evidence.length, 3);
  assert.deepEqual(
    result.cases[0].evidence.map((e) => e.nodeId),
    ['a', 'b', 'publish'],
  );
  const failed = buildWorkflowPlanReport({
    ...execution,
    events: [
      ...execution.events,
      event(10, 'node_state', { state: 'error' }, 'publish'),
    ],
  })!;
  assert.equal(failed.status, 'FAIL');
  assert.equal(failed.cases[0].status, 'FAIL');
});

test('missing suite evidence cannot pass and identical unqualified test names are ambiguous', () => {
  const missing = buildWorkflowPlanReport({
    ...execution,
    events: execution.events.filter((e) => e.id !== 6n),
  })!;
  assert.equal(missing.status, 'BLOCKED');
  assert.match(missing.cases[0].reason, /missing/);
  const ambiguousDefinition = {
    ...definition,
    testPlan: {
      ...plan,
      cases: [
        {
          ...plan.cases[0],
          tests: [{ title: 'same title', project: 'desktop' }],
        },
      ],
    },
  };
  const ambiguous = buildWorkflowPlanReport({
    ...execution,
    events: [
      event(1, 'execution_definition', ambiguousDefinition),
      ...execution.events.slice(1),
    ],
  })!;
  assert.equal(ambiguous.status, 'BLOCKED');
  assert.match(ambiguous.cases[0].reason, /multiple/);
});

test('report uses the frozen execution plan and never treats authored PASS as evidence', () => {
  const before = buildWorkflowPlanReport(execution)!;
  plan.markdown = '# Changed later';
  plan.cases[0].criteria = 'Changed later';
  const after = buildWorkflowPlanReport(execution)!;
  assert.equal(after.version, before.version);
  assert.equal(after.plan.markdown, '# Previously PASS');
  assert.equal(
    buildWorkflowPlanReport({ ...execution, events: [execution.events[0]] })!
      .status,
    'BLOCKED',
  );
  assert.equal(
    buildWorkflowPlanReport({ ...execution, status: 'running' })!.status,
    'BLOCKED',
  );
  assert.equal(
    buildWorkflowPlanReport({ ...execution, status: 'failed' })!.status,
    'FAIL',
  );
});
