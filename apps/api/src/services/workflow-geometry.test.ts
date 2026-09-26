import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getNodeDimensions,
  normalizeWorkflowNode,
  normalizeWorkflowNodes,
} from '../../../runners/shared/workflow-geometry';
import { parseWorkflowDefinition } from './workflow-definitions';

test('API definitions normalize imported geometry without changing the graph', () => {
  const config = {
    variables: [{ key: 'BASE_URL', initialValue: 'https://example.com' }],
  };
  const nodes = [
    {
      id: 'env',
      nodeType: 'environment',
      x: '100',
      y: '200',
      width: 96,
      height: 96,
      config,
    },
    { id: 'pw', nodeType: 'playwright', x: 500, y: 200, width: 96, height: 96 },
    {
      id: 'agent',
      nodeType: 'agent-container',
      x: 800,
      y: 200,
      width: 96,
      height: 96,
    },
  ];
  const connections = [{ id: 'c', sourceId: 'env', targetId: 'pw' }];
  const parsed = parseWorkflowDefinition({
    project: { key: 'geometry', title: 'Geometry' },
    workflow: { key: 'geometry', title: 'Geometry', nodes, connections },
  }).workflow;
  assert.deepEqual(
    parsed.nodes.map(({ x, y, width, height }) => ({ x, y, width, height })),
    [
      { x: 100, y: 200, width: 256 / Math.sqrt(3), height: 128 },
      { x: 500, y: 200, width: 128, height: 128 },
      { x: 800, y: 200, width: 360, height: 128 },
    ],
  );
  assert.deepEqual(parsed.connections, connections);
  assert.deepEqual(parsed.nodes[0].config, config);
  assert.equal(nodes[0].width, 96);
  assert.deepEqual(normalizeWorkflowNodes(parsed.nodes), parsed.nodes);
});

test('legacy geometry gets finite positions and canonical sizes for every node shape', () => {
  const nodes = normalizeWorkflowNodes([
    { id: 'missing', nodeType: 'playwright' },
    { id: 'invalid', nodeType: 'environment', x: null, y: Infinity },
    {
      id: 'strings',
      nodeType: 'schedule',
      x: '-100.5',
      y: '0',
      width: 0,
      height: -1,
    },
    {
      id: 'attachment',
      nodeType: 'project-memory',
      x: 'bad',
      y: '',
      width: 400,
    },
  ]);
  assert.deepEqual(nodes, [
    {
      id: 'missing',
      nodeType: 'playwright',
      x: 200,
      y: 300,
      width: 128,
      height: 128,
    },
    {
      id: 'invalid',
      nodeType: 'environment',
      x: 500,
      y: 300,
      width: 256 / Math.sqrt(3),
      height: 128,
    },
    {
      id: 'strings',
      nodeType: 'schedule',
      x: -100.5,
      y: 0,
      width: 128,
      height: 128,
    },
    {
      id: 'attachment',
      nodeType: 'project-memory',
      x: 1100,
      y: 300,
      width: 128,
      height: 128,
    },
  ]);
  assert.equal(normalizeWorkflowNodes(undefined), undefined);
  assert.equal(normalizeWorkflowNodes(null), null);
});

test('UI and API geometry agree even before a legacy node is normalized', () => {
  for (const nodeType of [
    'playwright',
    'environment',
    'agent-container',
    'schedule',
    'project-memory',
  ]) {
    const legacy = { nodeType, width: 96, height: 96, x: 0, y: 0 };
    const normalized = normalizeWorkflowNode(legacy);
    assert.deepEqual(getNodeDimensions(legacy), {
      width: normalized.width,
      height: normalized.height,
    });
  }
});
