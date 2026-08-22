import assert from 'node:assert/strict';
import test from 'node:test';
import {
  agentMemoryChangeScope,
  assertAgentMemoryMatchesCiExecution,
  extractAgentMemoryFromEvent,
  isAgentContainerWorkflowNode,
  MAX_AGENT_MEMORY_BYTES,
  MAX_AGENT_MEMORY_DEPTH,
  parseAgentMemory,
} from './agent-memory';

test('isolates pull request memory from same-named fork branches', () => {
  const sharedBranch = 'feature/validator';
  assert.equal(
    agentMemoryChangeScope({
      eventType: 'pull_request',
      headRef: sharedBranch,
      pullRequestNumber: 41,
    }),
    'pr:41',
  );
  assert.equal(
    agentMemoryChangeScope({
      eventType: 'pull_request',
      headRef: sharedBranch,
      pullRequestNumber: 42,
    }),
    'pr:42',
  );
  assert.equal(
    agentMemoryChangeScope({
      eventType: 'push',
      headRef: sharedBranch,
    }),
    `ref:${sharedBranch}`,
  );
});

test('fails closed when change identity cannot produce one memory scope', () => {
  assert.throws(
    () =>
      agentMemoryChangeScope({
        eventType: 'pull_request',
        headRef: 'feature/validator',
      }),
    /requires a positive 32-bit pull request number/,
  );
  assert.throws(
    () =>
      agentMemoryChangeScope({
        eventType: 'manual',
        headRef: 'feature/validator',
        pullRequestNumber: 42,
      }),
    /cannot contain a pull request number/,
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

test('binds durable memory identity to its authoritative CI execution', () => {
  const memory = {
    lastProcessedHeadSha: 'b'.repeat(40),
    repository: 'playrunner/playrunner',
    schemaVersion: '1.0',
  };
  assert.doesNotThrow(() =>
    assertAgentMemoryMatchesCiExecution(memory, {
      headSha: 'b'.repeat(40),
      repository: 'playrunner/playrunner',
    }),
  );
  assert.throws(
    () =>
      assertAgentMemoryMatchesCiExecution(
        { ...memory, repository: 'other/private' },
        {
          headSha: 'b'.repeat(40),
          repository: 'playrunner/playrunner',
        },
      ),
    /repository does not match/,
  );
  assert.throws(
    () =>
      assertAgentMemoryMatchesCiExecution(
        { ...memory, lastProcessedHeadSha: 'c'.repeat(40) },
        {
          headSha: 'b'.repeat(40),
          repository: 'playrunner/playrunner',
        },
      ),
    /head SHA does not match/,
  );
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
