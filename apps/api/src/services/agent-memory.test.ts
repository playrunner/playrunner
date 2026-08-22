import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractAgentMemoryFromEvent,
  isAgentContainerWorkflowNode,
  MAX_AGENT_MEMORY_BYTES,
  MAX_AGENT_MEMORY_DEPTH,
  parseAgentMemory,
  resolveMemoryBinding,
} from './agent-memory';

test('binds attached memory to the project and repository by default', () => {
  const workflow = {
    connections: [
      {
        attachmentPort: 'memory',
        role: 'attachment',
        sourceId: 'memory-1',
        targetId: 'container-1',
      },
    ],
    id: 'workflow-1',
    nodes: [
      {
        config: { repository: 'playrunner/playrunner' },
        id: 'container-1',
        nodeType: 'agent-container',
      },
      {
        config: { namespace: 'architecture', scope: 'project' },
        id: 'memory-1',
        nodeType: 'project-memory',
      },
    ],
    projectId: 'project-1',
    userId: 'user-1',
  };
  assert.deepEqual(resolveMemoryBinding(workflow, 'container-1'), {
    namespace: 'architecture',
    repository: 'playrunner/playrunner',
    scopeId: 'project-1',
    scopeKind: 'project',
  });
  assert.equal(
    resolveMemoryBinding({ ...workflow, connections: [] }, 'container-1'),
    null,
  );
  assert.deepEqual(
    resolveMemoryBinding(
      {
        ...workflow,
        nodes: [
          workflow.nodes[0],
          { ...workflow.nodes[1], config: { scope: 'workflow' } },
        ],
      },
      'container-1',
    ),
    {
      namespace: 'project',
      repository: 'playrunner/playrunner',
      scopeId: 'workflow-1',
      scopeKind: 'workflow',
    },
  );
});

test('extracts a bounded structured memory object from node output', () => {
  const memory = {
    baseSha: 'a'.repeat(40),
    generatedTests: ['tests/new-feature.test.ts'],
    schemaVersion: 1,
    summary: 'Covered the new validation branch.',
  };
  assert.deepEqual(
    extractAgentMemoryFromEvent({
      nodeId: 'agent-container-1',
      output: { memory, patch: 'must not be persisted as memory' },
      type: 'node_output',
    }),
    memory,
  );
});

test('recognizes memory only for the matching AI Container workflow node', () => {
  const nodes = [
    { id: 'javascript-1', nodeType: 'javascript' },
    { id: 'agent-container-1', nodeType: 'agent-container' },
  ];
  assert.equal(isAgentContainerWorkflowNode(nodes, 'agent-container-1'), true);
  assert.equal(isAgentContainerWorkflowNode(nodes, 'javascript-1'), false);
  assert.equal(isAgentContainerWorkflowNode({}, 'agent-container-1'), false);
});

test('ignores non-output events and outputs without memory', () => {
  assert.equal(
    extractAgentMemoryFromEvent({ output: { memory: {} }, type: 'log' }),
    null,
  );
  assert.equal(
    extractAgentMemoryFromEvent({
      output: { patch: 'diff' },
      type: 'node_output',
    }),
    null,
  );
});

test('rejects oversized, deeply nested, and dangerous memory values', () => {
  assert.throws(
    () => parseAgentMemory({ summary: 'x'.repeat(MAX_AGENT_MEMORY_BYTES) }),
    /oversized string|exceeds/,
  );

  let nested: Record<string, unknown> = { value: true };
  for (let depth = 0; depth <= MAX_AGENT_MEMORY_DEPTH; depth += 1) {
    nested = { nested };
  }
  assert.throws(() => parseAgentMemory(nested), /maximum depth/);

  const dangerous = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => parseAgentMemory(dangerous), /invalid object key/);
});
