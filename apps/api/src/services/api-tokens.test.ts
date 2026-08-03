import assert from 'node:assert/strict';
import test from 'node:test';
import {
  API_TOKEN_PREFIX,
  apiTokenHashesMatch,
  generateApiToken,
  hashApiToken,
  tokenCanExecuteWorkflow,
  tokenIsActive,
  WORKFLOW_EXECUTE_SCOPE,
} from './api-tokens';
import {
  sanitizeWorkflowLogMessage,
  toSafeWorkflowEvent,
} from './execution-events';

test('generates high-entropy recognizable tokens and stores comparable hashes', () => {
  const token = generateApiToken();

  assert.ok(token.startsWith(API_TOKEN_PREFIX));
  assert.ok(token.length >= API_TOKEN_PREFIX.length + 43);
  assert.equal(apiTokenHashesMatch(token, hashApiToken(token)), true);
  assert.equal(apiTokenHashesMatch(`${token}x`, hashApiToken(token)), false);
});

test('enforces scope and optional workflow restrictions', () => {
  assert.equal(
    tokenCanExecuteWorkflow(
      { scopes: [WORKFLOW_EXECUTE_SCOPE], allowedWorkflowIds: null },
      'workflow-a',
    ),
    true,
  );
  assert.equal(
    tokenCanExecuteWorkflow(
      {
        scopes: [WORKFLOW_EXECUTE_SCOPE],
        allowedWorkflowIds: ['workflow-a'],
      },
      'workflow-b',
    ),
    false,
  );
  assert.equal(
    tokenCanExecuteWorkflow(
      { scopes: [], allowedWorkflowIds: ['workflow-a'] },
      'workflow-a',
    ),
    false,
  );
});

test('rejects revoked and expired tokens', () => {
  assert.equal(tokenIsActive({ expiresAt: null, revokedAt: null }), true);
  assert.equal(
    tokenIsActive({ expiresAt: new Date(Date.now() - 1000), revokedAt: null }),
    false,
  );
  assert.equal(
    tokenIsActive({ expiresAt: null, revokedAt: new Date() }),
    false,
  );
});

test('machine event output redacts secrets and drops payload fields', () => {
  const event = toSafeWorkflowEvent({
    sequence: 7n,
    payload: {
      type: 'log',
      message: 'API key=pr_live_abcdefghijklmnopqrstuvwxyz123456',
      settings: { apiKey: 'secret-token-value' },
      timestamp: '2026-08-03T00:00:00.000Z',
    },
  });

  assert.deepEqual(event, {
    sequence: '7',
    type: 'log',
    level: null,
    message: 'API key=[redacted]',
    nodeId: null,
    state: null,
    timestamp: '2026-08-03T00:00:00.000Z',
  });
  assert.doesNotMatch(
    JSON.stringify(event),
    /pr_live_abcdefghijklmnopqrstuvwxyz123456|secret-token-value/,
  );
});

test('log sanitizer preserves useful output and redacts common credential forms', () => {
  const message = sanitizeWorkflowLogMessage(
    'Running test\nAuthorization: Bearer abc.def.ghi\n?token=secret-value',
  );

  assert.equal(
    message,
    'Running test\nAuthorization: Bearer [redacted]\n?token=[redacted]',
  );
});

test('machine event output synthesizes safe node progress', () => {
  assert.deepEqual(
    toSafeWorkflowEvent({
      sequence: 8n,
      payload: {
        type: 'node_state',
        nodeId: 'node-123',
        state: 'running',
        message: 'must not be returned',
      },
    }),
    {
      sequence: '8',
      type: 'node_state',
      level: null,
      message: 'Node node-123 is running.',
      nodeId: 'node-123',
      state: 'running',
      timestamp: null,
    },
  );
});
