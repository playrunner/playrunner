import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createMcpApp, callTool } from "./server";
import { WORKFLOW_EDITOR_URI } from "./workflow-editor";

test("editor resource discovery and reads preserve HTTP authentication and reject unknown resources", async (t) => {
  const server = createMcpApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as { port: number }).port;
  const rpc = (method: string, params = {}, auth = true) =>
    fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: "Bearer fixture" } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  assert.equal(
    (await rpc("resources/read", { uri: WORKFLOW_EDITOR_URI }, false)).status,
    401,
  );
  const listing = await (await rpc("resources/list")).json();
  assert.equal(listing.result.resources[0].uri, WORKFLOW_EDITOR_URI);
  const resource = await (
    await rpc("resources/read", { uri: WORKFLOW_EDITOR_URI })
  ).json();
  assert.equal(
    resource.result.contents[0].mimeType,
    "text/html;profile=mcp-app",
  );
  assert.match(resource.result.contents[0].text, /ui\/initialize/);
  assert.match(resource.result.contents[0].text, /renderWorkflowCanvas/);
  assert.match(resource.result.contents[0].text, /data:image\/svg/);
  assert.doesNotMatch(
    resource.result.contents[0].text,
    /WORKFLOW_CANVAS_(SCRIPT|STYLES)/,
  );
  assert.equal(
    (await (await rpc("resources/read", { uri: "file:///etc/passwd" })).json())
      .error.code,
    -32002,
  );
});

test("editor reads forward credentials and preserve denied-access failures", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls++;
    assert.ok(url.endsWith("/api/v1/workflows/id%20%2F/editor"));
    assert.equal(
      (init.headers as Record<string, string>).authorization,
      "Bearer fixture",
    );
    return {
      status: 403,
      json: async () => ({ error: "Management access required." }),
    };
  });
  for (const name of ["open_workflow_editor", "get_workflow_editor"]) {
    assert.equal(
      (
        await callTool("Bearer fixture", {
          name,
          arguments: { workflowId: "id /" },
        })
      ).isError,
      true,
    );
    assert.equal(
      (await callTool("Bearer fixture", { name, arguments: {} })).isError,
      true,
    );
  }
  assert.equal(calls, 2);
});
