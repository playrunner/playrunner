import assert from "node:assert/strict";
import test from "node:test";
import { callTool } from "./server";
import { MCP_TOOLS } from "./protocol";

test("MCP management and event tools forward the caller key to machine API routes", async (t) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let status = 204;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      status,
      json: async () =>
        status === 409 ? { error: "Project is not empty." } : { created: true },
    };
  });
  const key = "Bearer test-management";
  for (const kind of ["project", "workflow"]) {
    const result = await callTool(key, {
      name: `delete_${kind}`,
      arguments: { [`${kind}Id`]: "id /?" },
    });
    assert.equal(result.isError, false);
    assert.equal(calls.at(-1)!.init.method, "DELETE");
    assert.ok(calls.at(-1)!.url.endsWith(`/api/v1/${kind}s/id%20%2F%3F`));
    assert.equal(
      (calls.at(-1)!.init.headers as Record<string, string>).authorization,
      key,
    );
  }
  status = 409;
  assert.equal(
    (
      await callTool(key, {
        name: "delete_project",
        arguments: { projectId: "p" },
      })
    ).isError,
    true,
  );
  status = 201;
  const definition = {
    project: { key: "p", title: "Project" },
    workflow: {
      key: "w",
      title: "Workflow",
      nodes: [],
      connections: [],
      cloudProvider: "LOCAL_RUNNER",
    },
  };
  assert.equal(
    (await callTool(key, { name: "save_workflow", arguments: { definition } }))
      .isError,
    false,
  );
  assert.deepEqual(JSON.parse(calls.at(-1)!.init.body as string), definition);
  assert.equal(calls.at(-1)!.init.method, "PUT");
  status = 200;
  await callTool(key, {
    name: "get_run_events",
    arguments: {
      workflowId: "w",
      executionId: "e",
      after: "10000000000000000",
    },
  });
  assert.ok(
    calls
      .at(-1)!
      .url.endsWith(
        "/api/v1/workflows/w/executions/e/events?after=10000000000000000",
      ),
  );
  await callTool(key, { name: "list_projects", arguments: { limit: 5 } });
  assert.ok(calls.at(-1)!.url.endsWith("/api/v1/projects?limit=5"));
  const before = calls.length;
  for (const params of [
    { name: "delete_project", arguments: {} },
    { name: "save_workflow", arguments: { definition: {} } },
    {
      name: "get_run_events",
      arguments: { workflowId: "w", executionId: "e", after: "-1" },
    },
  ]) {
    assert.equal((await callTool(key, params)).isError, true);
  }
  assert.equal(calls.length, before);
  for (const name of [
    "delete_project",
    "delete_workflow",
    "save_workflow",
    "get_run_events",
    "list_projects",
  ])
    assert.ok(MCP_TOOLS.some((t) => t.name === name));
});

test("run_workflow preserves API acceptance criteria and CI context without overriding run inputs", async (t) => {
  let payload: Record<string, unknown> = {};
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: string, init: RequestInit) => {
      payload = JSON.parse(init.body as string);
      return {
        status: 202,
        json: async () => ({ executionId: "e", status: "running" }),
      };
    },
  );
  const context = {
    repository: { owner: "example", name: "repo" },
    headSha: "b".repeat(40),
    baseSha: "a".repeat(40),
    headRef: "main",
    baseRef: "main",
    eventType: "push",
  };
  const result = await callTool("Bearer test-management", {
    name: "run_workflow",
    arguments: {
      workflowId: "w",
      inputs: { mode: "smoke" },
      acceptanceCriteria: ["Login works"],
      changeContext: context,
    },
  });
  assert.equal(result.isError, false);
  assert.deepEqual(payload, {
    ...context,
    inputs: { mode: "smoke" },
    acceptanceCriteria: ["Login works"],
  });
  const rejected = await callTool("Bearer test-management", {
    name: "run_workflow",
    arguments: {
      workflowId: "w",
      changeContext: { inputs: { override: "bad" } },
    },
  });
  assert.equal(rejected.isError, true);
});
