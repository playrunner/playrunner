import assert from "node:assert/strict";
import test from "node:test";
import {
  JSON_RPC_INVALID_REQUEST,
  MCP_PROTOCOL_VERSION,
  MCP_TOOLS,
  initializeResult,
  jsonRpcFailure,
  negotiateProtocolVersion,
  parseGetReleaseVerdictArguments,
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
  assert.deepEqual(result.capabilities, {
    tools: { listChanged: false },
    resources: { listChanged: false },
  });
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

test("tools cover discovery, execution, event inspection and management", () => {
  assert.deepEqual(
    MCP_TOOLS.map((tool) => tool.name),
    [
      "open_workflow_editor",
      "get_workflow_editor",
      "list_projects",
      "save_workflow",
      "delete_project",
      "delete_workflow",
      "get_run_events",
      "list_workflows",
      "run_workflow",
      "get_release_policy",
      "get_release_verdict",
      "get_run_status",
      "list_runs",
    ],
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

const release = {
  candidate: {
    repository: "example/app",
    commitSha: "a".repeat(40),
    artifactDigest: `sha256:${"b".repeat(64)}`,
    environment: "staging",
    targetUrl: "https://staging.example.com",
  },
  policyVersion: "c".repeat(64),
  maxAgeSeconds: 600,
};

test("release tools advertise read-only evidence and an explicit release decision", () => {
  for (const name of ["get_release_policy", "get_release_verdict"]) {
    const tool = MCP_TOOLS.find((tool) => tool.name === name)!;
    assert.ok("annotations" in tool);
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.annotations?.destructiveHint, false);
  }
  const instructions = initializeResult({}).instructions;
  assert.match(instructions, /RELEASE_IDENTITY/);
  assert.match(instructions, /never copied from the request/);
  assert.match(instructions, /Only PASS with allowed true/);
  assert.match(instructions, /completion alone never does/);
});

test("release verification preserves the exact expected candidate and policy", () => {
  const run = parseRunWorkflowArguments({ workflowId: "w", release });
  assert.ok(!("error" in run));
  assert.deepEqual(run.release, release);
  assert.deepEqual(
    parseGetReleaseVerdictArguments({
      workflowId: " w ",
      executionId: " e ",
      ...release,
    }),
    { workflowId: "w", executionId: "e", ...release },
  );
  assert.ok(
    "error" in
      parseRunWorkflowArguments({
        workflowId: "w",
        release,
        changeContext: {},
      }),
  );
});

test("release tools reject incomplete or malformed identity and policy arguments", () => {
  const invalid = [
    null,
    {},
    { ...release, candidate: { ...release.candidate, commitSha: "abc123" } },
    {
      ...release,
      candidate: { ...release.candidate, artifactDigest: "latest" },
    },
    { ...release, candidate: { ...release.candidate, repository: "example" } },
    { ...release, candidate: { ...release.candidate, environment: "" } },
    {
      ...release,
      candidate: { ...release.candidate, targetUrl: "file:///app" },
    },
    {
      ...release,
      candidate: {
        ...release.candidate,
        targetUrl: "https://user:pass@example.com",
      },
    },
    {
      ...release,
      candidate: {
        ...release.candidate,
        targetUrl: "https://example.com?token=secret",
      },
    },
    {
      ...release,
      candidate: {
        ...release.candidate,
        targetUrl: "https://example.com#fragment",
      },
    },
    { ...release, candidate: { ...release.candidate, extra: "ignored?" } },
    { ...release, policyVersion: "latest" },
    { ...release, maxAgeSeconds: 0 },
    { ...release, maxAgeSeconds: 86401 },
    { ...release, maxAgeSeconds: 1.5 },
    { ...release, extra: "ignored?" },
  ];
  for (const value of invalid) {
    assert.ok(
      "error" in parseRunWorkflowArguments({ workflowId: "w", release: value }),
      `expected invalid release: ${JSON.stringify(value)}`,
    );
  }
  assert.ok(
    "error" in parseGetReleaseVerdictArguments({ workflowId: "w", ...release }),
  );
  assert.ok(
    "error" in
      parseGetReleaseVerdictArguments({ executionId: "e", ...release }),
  );
  assert.ok(
    "error" in
      parseGetReleaseVerdictArguments({ workflowId: "w", executionId: "e" }),
  );
});
