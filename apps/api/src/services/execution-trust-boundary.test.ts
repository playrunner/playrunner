import assert from 'node:assert/strict';
import test from 'node:test';
import {
  machineExecutionCiPolicyError,
  sanitizeInteractiveExecutionBody,
} from './execution-trust-boundary';

test('interactive executions cannot inject machine-owned CI context or memory', () => {
  assert.deepEqual(
    sanitizeInteractiveExecutionBody({
      agentMemoryByNodeId: { agent: { summary: 'untrusted' } },
      authenticationStatesByNodeId: { playwright: { cookies: ['secret'] } },
      authenticationProfileNodeIds: ['playwright'],
      ci: { headSha: 'untrusted' },
      cloudProvider: 'LOCAL_RUNNER',
      nodes: [{ id: 'agent' }],
    }),
    {
      cloudProvider: 'LOCAL_RUNNER',
      nodes: [{ id: 'agent' }],
    },
  );
  assert.deepEqual(sanitizeInteractiveExecutionBody([]), {});
});

test('AI Container machine runs accept only trusted source push contexts', () => {
  const nodes = [
    { id: 'setup', nodeType: 'environment' },
    { id: 'agent', nodeType: 'agent-container' },
  ];

  assert.equal(machineExecutionCiPolicyError(nodes, 'push'), null);
  for (const eventType of ['pull_request', 'manual']) {
    assert.equal(
      machineExecutionCiPolicyError(nodes, eventType),
      'AI Container machine executions support trusted source push events only. pull_request and manual CI contexts are not supported.',
    );
  }
  assert.equal(
    machineExecutionCiPolicyError(
      [{ id: 'tests', nodeType: 'playwright' }],
      'pull_request',
    ),
    null,
  );
});
