import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppNodeType } from '../components/NodeSelectorModal';
import {
  DEFAULT_PROJECT_NODE_TYPES,
  createStarterWorkflow,
  normalizeProjectNodeTypes,
} from './projectDefaults';

const availableNodeTypes: AppNodeType[] = [
  {
    id: 'environment',
    label: 'Environment',
    type: 'config',
    acceptsInboundConnection: false,
    executionRole: 'workflow',
    acceptsAttachments: [],
  },
  {
    id: 'playwright',
    label: 'Playwright',
    type: 'trigger',
    acceptsInboundConnection: true,
    executionRole: 'workflow',
    acceptsAttachments: [],
  },
  {
    id: 'resend',
    label: 'Resend',
    type: 'action',
    acceptsInboundConnection: true,
    executionRole: 'workflow',
    acceptsAttachments: [],
  },
];

test('uses the standard project defaults when no setting has been saved', () => {
  assert.deepEqual(normalizeProjectNodeTypes(null), DEFAULT_PROJECT_NODE_TYPES);
});

test('creates ordered nodes and connections from project defaults', () => {
  const workflow = createStarterWorkflow(
    ['environment', 'resend'],
    availableNodeTypes,
  );

  assert.deepEqual(
    workflow.nodes.map((node) => node.nodeType),
    ['environment', 'resend'],
  );
  assert.equal(workflow.connections.length, 1);
  assert.equal(workflow.connections[0].sourceId, workflow.nodes[0].id);
  assert.equal(workflow.connections[0].targetId, workflow.nodes[1].id);
});

test('supports blank workflows and does not connect into config nodes', () => {
  assert.deepEqual(createStarterWorkflow([], availableNodeTypes), {
    nodes: [],
    connections: [],
  });

  const workflow = createStarterWorkflow(
    ['playwright', 'environment'],
    availableNodeTypes,
  );
  assert.equal(workflow.connections.length, 0);
});
