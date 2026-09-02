import assert from 'node:assert/strict';
import test from 'node:test';
import {
  JSON_RPC_INVALID_REQUEST,
  MCP_PROTOCOL_VERSION,
  MCP_TOOLS,
  initializeResult,
  interpretRunWorkflowResponse,
  jsonRpcFailure,
  negotiateProtocolVersion,
  parseListWorkflowsArguments,
  parseMcpRequest,
  parseRunWorkflowArguments,
  runWorkflowDispatch,
} from './mcp';

test('a well formed request is parsed into a method and params', () => {
  const parsed = parseMcpRequest({
    id: 1,
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { name: 'run_workflow' },
  });
  assert.ok('request' in parsed);
  assert.deepEqual(parsed.request, {
    id: 1,
    isNotification: false,
    method: 'tools/call',
    params: { name: 'run_workflow' },
  });
});

test('a message without an id is a notification and expects no reply', () => {
  const parsed = parseMcpRequest({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  });
  assert.ok('request' in parsed);
  assert.equal(parsed.request.isNotification, true);
});

test('malformed envelopes are rejected before any tool runs', () => {
  for (const body of [
    null,
    'nope',
    { jsonrpc: '1.0', method: 'ping' },
    {
      jsonrpc: '2.0',
    },
  ]) {
    const parsed = parseMcpRequest(body);
    assert.ok(
      'failure' in parsed,
      `expected failure for ${JSON.stringify(body)}`,
    );
    assert.equal(parsed.failure.error.code, JSON_RPC_INVALID_REQUEST);
  }
});

test('batched requests are refused rather than partially handled', () => {
  const parsed = parseMcpRequest([{ jsonrpc: '2.0', id: 1, method: 'ping' }]);
  assert.ok('failure' in parsed);
  assert.equal(parsed.failure.error.code, JSON_RPC_INVALID_REQUEST);
});

test('an unsupported protocol version falls back to the version we speak', () => {
  assert.equal(negotiateProtocolVersion('2025-03-26'), '2025-03-26');
  assert.equal(negotiateProtocolVersion('2026-07-28'), MCP_PROTOCOL_VERSION);
  assert.equal(negotiateProtocolVersion(undefined), MCP_PROTOCOL_VERSION);
});

test('initialize advertises tools and no session-dependent capability', () => {
  const result = initializeResult({ protocolVersion: '2025-06-18' });
  assert.equal(result.protocolVersion, '2025-06-18');
  assert.deepEqual(result.capabilities, { tools: { listChanged: false } });
  assert.equal(result.serverInfo.name, 'playrunner');
});

/**
 * Hosts that probe with a newer discovery method only fall back to `initialize`
 * when the probe reads as an older server. MethodNotFound is that signal, so an
 * unknown method must not be answered with a protocol-version complaint.
 */
test('an unknown method is MethodNotFound, which is what host fallback keys off', () => {
  const failure = jsonRpcFailure(7, -32601, 'Unknown method: server/discover');
  assert.equal(failure.error.code, -32601);
  assert.equal(failure.id, 7);
  assert.ok(!('data' in failure.error));
});

test('v1 exposes discovery and dispatch only, and never workflow mutation', () => {
  assert.deepEqual(
    MCP_TOOLS.map((tool) => tool.name),
    ['list_workflows', 'run_workflow'],
  );
});

test('list_workflows rejects a limit outside the supported page size', () => {
  assert.deepEqual(parseListWorkflowsArguments({}), { limit: 50 });
  assert.deepEqual(parseListWorkflowsArguments({ limit: 10 }), { limit: 10 });
  assert.ok('error' in parseListWorkflowsArguments({ limit: 0 }));
  assert.ok('error' in parseListWorkflowsArguments({ limit: 1000 }));
  assert.ok('error' in parseListWorkflowsArguments({ limit: 1.5 }));
});

test('run_workflow requires a workflow id and well typed optional arguments', () => {
  assert.ok('error' in parseRunWorkflowArguments({}));
  assert.ok('error' in parseRunWorkflowArguments({ workflowId: '  ' }));
  assert.ok(
    'error' in parseRunWorkflowArguments({ inputs: [], workflowId: 'w1' }),
  );
  assert.ok(
    'error' in
      parseRunWorkflowArguments({
        idempotencyKey: 'x'.repeat(201),
        workflowId: 'w1',
      }),
  );
});

test('run_workflow supplies an idempotency key when the caller omits one', () => {
  const parsed = parseRunWorkflowArguments({ workflowId: 'w1' });
  assert.ok(!('error' in parsed));
  assert.equal(typeof parsed.idempotencyKey, 'string');
  assert.ok(parsed.idempotencyKey.length > 0);

  const supplied = parseRunWorkflowArguments({
    idempotencyKey: 'caller-key',
    workflowId: 'w1',
  });
  assert.ok(!('error' in supplied));
  assert.equal(supplied.idempotencyKey, 'caller-key');
});

/**
 * Run metering on cloud is keyed off the request path at the gateway in front
 * of this service. Dispatching to anything other than the public machine
 * execution URL would start runs that are never counted against the account
 * quota, so the dispatch target is asserted exactly.
 */
test('run_workflow dispatches to the metered public execution endpoint', () => {
  const dispatch = runWorkflowDispatch({
    authorization: 'Bearer pr_live_token',
    baseUrl: 'https://playrunner.cloud/',
    idempotencyKey: 'key-1',
    inputs: { branch: 'main' },
    workflowId: 'workflow 1/2',
  });
  assert.equal(
    dispatch.url,
    'https://playrunner.cloud/api/v1/workflows/workflow%201%2F2/executions',
  );
  assert.equal(dispatch.init.method, 'POST');
  assert.equal(dispatch.init.headers.authorization, 'Bearer pr_live_token');
  assert.equal(dispatch.init.headers['idempotency-key'], 'key-1');
  assert.deepEqual(JSON.parse(dispatch.init.body), {
    inputs: { branch: 'main' },
  });
});

test('an empty input set dispatches an empty body rather than a null input', () => {
  const dispatch = runWorkflowDispatch({
    authorization: 'Bearer pr_live_token',
    baseUrl: 'https://playrunner.cloud',
    idempotencyKey: 'key-1',
    inputs: {},
    workflowId: 'w1',
  });
  assert.deepEqual(JSON.parse(dispatch.init.body), {});
});

test('an accepted run is reported with its execution id', () => {
  const result = interpretRunWorkflowResponse(
    202,
    { executionId: 'exec-1', status: 'running', workflowId: 'w1' },
    'w1',
  );
  assert.equal(result.isError, false);
  assert.deepEqual(result.structuredContent, {
    executionId: 'exec-1',
    status: 'running',
    workflowId: 'w1',
  });
});

test('a deduplicated run is surfaced so an agent does not start a second one', () => {
  const result = interpretRunWorkflowResponse(
    202,
    { deduplicated: true, executionId: 'exec-1', status: 'running' },
    'w1',
  );
  assert.equal(result.structuredContent?.deduplicated, true);
});

test('an exhausted quota is a tool error the model can read, not a retry loop', () => {
  const result = interpretRunWorkflowResponse(
    402,
    {
      code: 'WORKFLOW_RUN_LIMIT_EXCEEDED',
      error:
        'This account has used all 100 workflow runs included in its current billing period.',
    },
    'w1',
  );
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /retrying will not help/);
});

test('an unrunnable workflow points the agent back at discovery', () => {
  const result = interpretRunWorkflowResponse(404, {}, 'w1');
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /list_workflows/);
});

test('an unexpected upstream status is an error rather than a fabricated run', () => {
  const result = interpretRunWorkflowResponse(
    503,
    { error: 'Runner unavailable.' },
    'w1',
  );
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /HTTP 503/);
  assert.equal(result.structuredContent, undefined);
});
