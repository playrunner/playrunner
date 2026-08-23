import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseWorkflowDefinition,
  workflowDefinitionIds,
} from './workflow-definitions';

function definition() {
  return {
    project: { key: 'demo', title: 'Demo project' },
    workflow: {
      key: 'demo-tests',
      title: 'Demo tests',
      nodes: [
        { id: 'environment', nodeType: 'environment' },
        {
          config: {
            skillSources: [
              {
                id: 'project-skills',
                path: '.agents/skills',
                type: 'project',
              },
              {
                id: 'shared-skills',
                path: 'skills/testing',
                ref: 'v1.2.3',
                repository: 'playrunner/agent-skills',
                type: 'github',
              },
            ],
          },
          id: 'container',
          nodeType: 'agent-container',
        },
      ],
      connections: [
        { id: 'connection', sourceId: 'environment', targetId: 'container' },
      ],
    },
  };
}

test('parses a bounded workflow definition and assigns stable owned ids', () => {
  const parsed = parseWorkflowDefinition(definition());
  assert.equal(parsed.workflow.cloudProvider, 'LOCAL_RUNNER');
  assert.deepEqual(
    workflowDefinitionIds('user-1', parsed),
    workflowDefinitionIds('user-1', parsed),
  );
  assert.notDeepEqual(
    workflowDefinitionIds('user-1', parsed),
    workflowDefinitionIds('user-2', parsed),
  );
  assert.deepEqual(parsed.workflow.nodes[1].config, {
    skillSources: [
      {
        id: 'project-skills',
        path: '.agents/skills',
        type: 'project',
      },
      {
        id: 'shared-skills',
        path: 'skills/testing',
        ref: 'v1.2.3',
        repository: 'playrunner/agent-skills',
        type: 'github',
      },
    ],
  });
});

test('rejects connections to missing nodes', () => {
  const value = definition();
  value.workflow.connections[0].targetId = 'missing';
  assert.throws(() => parseWorkflowDefinition(value), /unknown node/);
});

test('rejects a missing definition as a validation error', () => {
  assert.throws(() => parseWorkflowDefinition(undefined), /JSON object/);
});

test('rejects secret values embedded in a definition file', () => {
  const value = definition();
  value.workflow.nodes[0] = {
    id: 'environment',
    nodeType: 'environment',
    config: {
      variables: [
        {
          key: 'OPENAI_API_KEY',
          type: 'secret',
          currentValue: 'must-not-be-committed',
        },
      ],
    },
  } as (typeof value.workflow.nodes)[number];
  assert.throws(
    () => parseWorkflowDefinition(value),
    /must not contain secret/,
  );
});
