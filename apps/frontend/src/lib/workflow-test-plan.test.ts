import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateNodePlans } from './workflow-test-plan';

test('moves existing node plans without changing originals or losing source-node mappings', () => {
  const plan = {
    name: 'original.md',
    markdown: '# Original\nExact contents',
    cases: [
      {
        id: 'CASE-1',
        criteria: 'Pass',
        description: 'Check',
        tests: [{ title: 'same title', project: '' }],
      },
    ],
  };
  const nodes = [
    { id: 'a', label: 'First', config: { testPlan: plan, action: 'upload' } },
  ];
  const migrated = migrateNodePlans(nodes);
  assert.equal(migrated.testPlan?.markdown, plan.markdown);
  assert.equal(migrated.testPlan?.cases[0].tests[0].nodeId, 'a');
  assert.deepEqual(migrated.nodes[0].config, { action: 'upload' });
  assert.equal(nodes[0].config.testPlan, plan);
  const combined = migrateNodePlans([
    ...nodes,
    { id: 'b', label: 'Second', config: { testPlan: plan, action: 'upload' } },
  ]);
  assert.equal(combined.testPlan?.cases.length, 2);
  assert.deepEqual(
    combined.testPlan?.cases.map((c) => c.tests[0].nodeId),
    ['a', 'b'],
  );
  assert.equal(new Set(combined.testPlan?.cases.map((c) => c.id)).size, 2);
});
