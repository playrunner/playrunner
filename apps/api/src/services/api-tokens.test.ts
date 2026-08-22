import assert from 'node:assert/strict';
import test from 'node:test';
import {
  API_TOKEN_PREFIX,
  apiTokenHashesMatch,
  generateApiToken,
  hashApiToken,
  tokenCanExecuteWorkflow,
  tokenCanWriteWorkflows,
  tokenIsActive,
  WORKFLOW_EXECUTE_SCOPE,
  WORKFLOW_WRITE_SCOPE,
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

test('allows only unrestricted write-scoped tokens to manage definitions', () => {
  assert.equal(
    tokenCanWriteWorkflows({
      scopes: [WORKFLOW_WRITE_SCOPE],
      allowedWorkflowIds: null,
    }),
    true,
  );
  assert.equal(
    tokenCanWriteWorkflows({
      scopes: [WORKFLOW_EXECUTE_SCOPE],
      allowedWorkflowIds: null,
    }),
    false,
  );
  assert.equal(
    tokenCanWriteWorkflows({
      scopes: [WORKFLOW_WRITE_SCOPE],
      allowedWorkflowIds: ['workflow-a'],
    }),
    false,
  );
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

test('machine event output never exposes node output or durable memory', () => {
  const event = toSafeWorkflowEvent({
    sequence: 9n,
    payload: {
      nodeId: 'agent-container-1',
      output: {
        memory: { summary: 'private repository context' },
        patch: 'private generated patch',
      },
      type: 'node_output',
    },
  });

  assert.deepEqual(event, {
    sequence: '9',
    type: 'event',
    level: null,
    message: null,
    nodeId: 'agent-container-1',
    state: null,
    timestamp: null,
  });
  assert.doesNotMatch(
    JSON.stringify(event),
    /repository context|generated patch/,
  );
});

test('machine event output exposes only validated bot pull request metadata', () => {
  const event = toSafeWorkflowEvent({
    sequence: 10n,
    payload: {
      baseRef: 'feature/checkout',
      draft: true,
      headRef: 'playrunner/tests/aaaaaaaaaaaa-bbbbbbbbbbbbbbbb',
      level: 'success',
      message: 'untrusted override',
      nodeId: 'agent-container-1',
      number: 42,
      output: {
        memory: { summary: 'private durable memory' },
        patch: 'private generated patch',
        secret: 'github-secret',
      },
      repository: 'playrunner/example',
      status: 'created',
      timestamp: '2026-08-21T00:00:00.000Z',
      type: 'bot_pull_request',
      url: 'https://github.com/playrunner/example/pull/42',
    },
  });

  assert.deepEqual(event, {
    baseRef: 'feature/checkout',
    draft: true,
    headRef: 'playrunner/tests/aaaaaaaaaaaa-bbbbbbbbbbbbbbbb',
    level: 'success',
    message:
      'Generated-test PR #42 (created): https://github.com/playrunner/example/pull/42',
    nodeId: 'agent-container-1',
    number: 42,
    repository: 'playrunner/example',
    sequence: '10',
    state: null,
    status: 'created',
    timestamp: '2026-08-21T00:00:00.000Z',
    type: 'bot_pull_request',
    url: 'https://github.com/playrunner/example/pull/42',
  });
  assert.doesNotMatch(
    JSON.stringify(event),
    /private durable memory|private generated patch|github-secret|untrusted override/,
  );
});

test('machine event output fails closed on mismatched bot pull request metadata', () => {
  for (const payload of [
    {
      baseRef: 'feature/checkout',
      draft: true,
      headRef: 'playrunner/tests/safe',
      number: 42,
      repository: 'playrunner/example',
      status: 'created',
      type: 'bot_pull_request',
      url: 'https://github.com/someone/else/pull/42',
    },
    {
      baseRef: 'feature/checkout',
      draft: true,
      headRef: 'playrunner/tests/safe',
      number: 42,
      repository: 'playrunner/example',
      status: 'open',
      type: 'bot_pull_request',
      url: 'https://github.com/playrunner/example/pull/42',
    },
  ]) {
    const event = toSafeWorkflowEvent({ sequence: 11n, payload });
    assert.equal(event.type, 'event');
    assert.equal(event.message, null);
    assert.equal(Object.hasOwn(event, 'url'), false);
    assert.equal(Object.hasOwn(event, 'repository'), false);
  }
});
