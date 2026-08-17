import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyLinkedWorkflowEnvironments,
  getLinkedEnvironmentIds,
} from './workflow-environments';

const nodes = [
  {
    id: 'environment-node',
    nodeType: 'environment',
    config: {
      environmentId: 'environment-1',
      variables: [{ key: 'OLD', type: 'default', value: 'stale' }],
    },
  },
  { id: 'javascript-node', nodeType: 'javascript', config: {} },
];

test('collects linked global environments from environment nodes', () => {
  assert.deepEqual(getLinkedEnvironmentIds(nodes), ['environment-1']);
});

test('hydrates linked nodes from the latest owner environment values', () => {
  const variables = [
    { key: 'TOKEN', type: 'secret' },
    { key: 'URL', type: 'default', value: 'https://latest.example' },
  ];
  const hydrated = applyLinkedWorkflowEnvironments(
    nodes,
    new Map([['environment-1', variables]]),
  ) as typeof nodes;

  assert.deepEqual(hydrated[0].config?.variables, variables);
  assert.deepEqual(hydrated[1], nodes[1]);
  assert.deepEqual(nodes[0].config.variables, [
    { key: 'OLD', type: 'default', value: 'stale' },
  ]);
});
