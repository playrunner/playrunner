import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Prisma } from '../generated/prisma/client.cts';
import {
  extractAgentMemoryFromEvent,
  isAgentContainerWorkflowNode,
  MAX_AGENT_MEMORY_BYTES,
  MAX_AGENT_MEMORY_DEPTH,
  parseAgentMemory,
  persistAgentMemoryRecord,
  resolveMemoryBinding,
} from './agent-memory';

test('persists agent memory with one atomic, stale-safe conflict query', async () => {
  let captured: Prisma.Sql | undefined;
  const createdAt = new Date('2026-08-23T01:02:03.000Z');
  await persistAgentMemoryRecord(
    {
      namespace: 'project',
      ownerUserId: 'local-admin',
      projectId: null,
      providerId: 'project-memory',
      repository: 'playrunner/demo-project',
      scopeId: 'workflow-1',
      scopeKind: 'workflow',
      sourceExecutionCreatedAt: createdAt,
      sourceExecutionId: 'execution-2',
      sourceHeadSha: 'a'.repeat(40),
      state: { repository: 'playrunner/demo-project', summary: 'updated' },
      workflowId: 'workflow-1',
    },
    async (query) => {
      captured = query;
      return 1;
    },
  );

  assert.ok(captured);
  const sql = captured.sql.replace(/\s+/g, ' ').trim();
  assert.match(sql, /INSERT INTO "ProjectMemory"/);
  assert.match(
    sql,
    /ON CONFLICT \( "ownerUserId", "providerId", "scopeKind", "scopeId", "repository", "namespace" \) DO UPDATE/,
  );
  assert.match(
    sql,
    /"ProjectMemory"\."sourceExecutionCreatedAt" <= EXCLUDED\."sourceExecutionCreatedAt"/,
  );
  assert.equal(captured.values.includes(createdAt), true);
  assert.equal(
    captured.values.includes(
      JSON.stringify({
        repository: 'playrunner/demo-project',
        summary: 'updated',
      }),
    ),
    true,
  );
});

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
