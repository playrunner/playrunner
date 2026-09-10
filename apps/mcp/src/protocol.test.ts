import assert from "node:assert/strict";
import test from "node:test";
import {
  JSON_RPC_INVALID_REQUEST,
  MCP_PROTOCOL_VERSION,
  MCP_TOOLS,
  initializeResult,
  jsonRpcFailure,
  negotiateProtocolVersion,
  parseGetRunStatusArguments,
  parseLimit,
  parseMcpRequest,
  parseRunWorkflowArguments,
} from "./protocol";

test("a well formed request is parsed into a method and params", () => {
  const parsed = parseMcpRequest({
    id: 1,
    jsonrpc: "2.0",
    method: "tools/call",
    params: { name: "run_workflow" },
  });
  assert.ok("request" in parsed);
  assert.deepEqual(parsed.request, {
    id: 1,
    isNotification: false,
    method: "tools/call",
    params: { name: "run_workflow" },
  });
});

test("a message without an id is a notification and expects no reply", () => {
  const parsed = parseMcpRequest({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  assert.ok("request" in parsed);
  assert.equal(parsed.request.isNotification, true);
});

test("malformed envelopes are rejected before any tool runs", () => {
  for (const body of [
    null,
    "nope",
    { jsonrpc: "1.0", method: "ping" },
    { jsonrpc: "2.0" },
  ]) {
    const parsed = parseMcpRequest(body);
    assert.ok(
      "failure" in parsed,
      `expected failure for ${JSON.stringify(body)}`,
    );
    assert.equal(parsed.failure.error.code, JSON_RPC_INVALID_REQUEST);
  }
});

test("batched requests are refused rather than partially handled", () => {
  const parsed = parseMcpRequest([{ jsonrpc: "2.0", id: 1, method: "ping" }]);
  assert.ok("failure" in parsed);
  assert.equal(parsed.failure.error.code, JSON_RPC_INVALID_REQUEST);
});

test("an unsupported protocol version falls back to the version we speak", () => {
  assert.equal(negotiateProtocolVersion("2025-03-26"), "2025-03-26");
  assert.equal(negotiateProtocolVersion("2026-07-28"), MCP_PROTOCOL_VERSION);
  assert.equal(negotiateProtocolVersion(undefined), MCP_PROTOCOL_VERSION);
});

test("initialize advertises tools and no session-dependent capability", () => {
  const result = initializeResult({ protocolVersion: "2025-06-18" });
  assert.equal(result.protocolVersion, "2025-06-18");
  assert.deepEqual(result.capabilities, { tools: { listChanged: false } });
  assert.equal(result.serverInfo.name, "playrunner");
});

/**
 * Hosts that probe with a newer discovery method only fall back to `initialize`
 * when the probe reads as an older server. MethodNotFound is that signal, so an
 * unknown method must not be answered with a protocol-version complaint.
 */
test("an unknown method is MethodNotFound, which is what host fallback keys off", () => {
  const failure = jsonRpcFailure(7, -32601, "Unknown method: server/discover");
  assert.equal(failure.error.code, -32601);
  assert.equal(failure.id, 7);
});

test("v1 exposes discovery, dispatch and inspection, never workflow mutation", () => {
  assert.deepEqual(
    MCP_TOOLS.map((tool) => tool.name),
    ["list_workflows", "run_workflow", "get_run_status", "list_runs"],
  );
});

test("a limit outside the supported page size is rejected", () => {
  assert.deepEqual(parseLimit(undefined), { limit: 25 });
  assert.deepEqual(parseLimit(10), { limit: 10 });
  assert.ok("error" in parseLimit(0));
  assert.ok("error" in parseLimit(101));
  assert.ok("error" in parseLimit(1.5));
  assert.ok("error" in parseLimit("10"));
});

test("run_workflow requires a workflow id and well typed optional arguments", () => {
  assert.ok("error" in parseRunWorkflowArguments({}));
  assert.ok("error" in parseRunWorkflowArguments({ workflowId: "  " }));
  assert.ok(
    "error" in parseRunWorkflowArguments({ inputs: [], workflowId: "w1" }),
  );
  assert.ok(
    "error" in
      parseRunWorkflowArguments({
        idempotencyKey: "x".repeat(201),
        workflowId: "w1",
      }),
  );
});

test("get_run_status requires both the workflow and the execution", () => {
  assert.ok("error" in parseGetRunStatusArguments({ workflowId: "w1" }));
  assert.ok("error" in parseGetRunStatusArguments({ executionId: "e1" }));
  assert.deepEqual(
    parseGetRunStatusArguments({ executionId: " e1 ", workflowId: " w1 " }),
    { executionId: "e1", workflowId: "w1" },
  );
});
