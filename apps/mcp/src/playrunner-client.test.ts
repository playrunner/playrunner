import assert from "node:assert/strict";
import test from "node:test";
import {
  interpretListResponse,
  interpretRunWorkflowResponse,
  machineFailure,
  machineRequest,
} from "./playrunner-client";

const AUTHORIZATION = "Bearer pr_live_token";

/**
 * Run metering on cloud is keyed off the request path at the gateway in front
 * of the API, so this server must reach the API through its configured public
 * base URL and the documented machine paths. A run started any other way would
 * consume compute without being counted against the account quota.
 */
test("a run is dispatched to the metered machine execution path", () => {
  const request = machineRequest({
    authorization: AUTHORIZATION,
    idempotencyKey: "key-1",
    method: "POST",
    path: "/api/v1/workflows/workflow%201/executions",
    payload: { inputs: { branch: "main" } },
  });
  assert.match(request.url, /\/api\/v1\/workflows\/workflow%201\/executions$/);
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers.authorization, AUTHORIZATION);
  assert.equal(request.init.headers["idempotency-key"], "key-1");
  assert.deepEqual(JSON.parse(request.init.body), {
    inputs: { branch: "main" },
  });
});

test("an omitted idempotency key is generated rather than left absent", () => {
  const request = machineRequest({
    authorization: AUTHORIZATION,
    method: "POST",
    path: "/api/v1/workflows/w1/executions",
  });
  assert.ok(request.init.headers["idempotency-key"].length > 0);
});

test("query parameters are appended and undefined values dropped", () => {
  const request = machineRequest({
    authorization: AUTHORIZATION,
    method: "GET",
    path: "/api/v1/workflows",
    query: { cursor: undefined, limit: 10 },
  });
  assert.match(request.url, /\/api\/v1\/workflows\?limit=10$/);
  assert.equal(request.init.headers["content-type"], undefined);
});

test("an accepted run is reported with its execution id", () => {
  const result = interpretRunWorkflowResponse(
    { body: { executionId: "exec-1", status: "running" }, status: 202 },
    "w1",
  );
  assert.equal(result.isError, false);
  assert.deepEqual(result.structuredContent, {
    executionId: "exec-1",
    status: "running",
    workflowId: "w1",
  });
});

test("a deduplicated run is surfaced so an agent does not start a second one", () => {
  const result = interpretRunWorkflowResponse(
    {
      body: { deduplicated: true, executionId: "exec-1", status: "running" },
      status: 202,
    },
    "w1",
  );
  assert.equal(result.structuredContent?.deduplicated, true);
});

test("an exhausted quota is a tool error the model can read, not a retry loop", () => {
  const result = interpretRunWorkflowResponse(
    {
      body: {
        code: "WORKFLOW_RUN_LIMIT_EXCEEDED",
        error:
          "This account has used all 100 workflow runs included in its current billing period.",
      },
      status: 402,
    },
    "w1",
  );
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /retrying will not help/);
});

test("an unrunnable workflow points the agent back at discovery", () => {
  const result = interpretRunWorkflowResponse({ body: {}, status: 404 }, "w1");
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /list_workflows/);
});

test("a revoked token is reported as a credential problem, not an outage", () => {
  const result = machineFailure(
    { body: { error: "Unauthorized" }, status: 401 },
    { notFound: "unused" },
  );
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /revoked or expired/);
});

test("an unexpected upstream status is an error rather than a fabricated result", () => {
  const result = interpretListResponse(
    { body: { error: "Runner unavailable." }, status: 503 },
    { notFound: "unused" },
  );
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /HTTP 503/);
  assert.equal(result.structuredContent, undefined);
});

test("a successful list is passed through as structured content", () => {
  const result = interpretListResponse(
    { body: { workflows: [{ id: "w1", title: "Smoke" }] }, status: 200 },
    { notFound: "unused" },
  );
  assert.equal(result.isError, false);
  assert.deepEqual(result.structuredContent, {
    workflows: [{ id: "w1", title: "Smoke" }],
  });
});
