/**
 * Stateless Streamable HTTP MCP protocol layer.
 *
 * Every request carries its own `Authorization: Bearer pr_live_…` and no
 * session is retained between calls, which is what MCP hosts that store a
 * static token per server expect.
 *
 * The protocol is implemented directly rather than via
 * `@modelcontextprotocol/sdk` because a stateless tools-only server needs
 * `initialize`, `tools/list` and `tools/call` and nothing else, while the SDK
 * would add express, hono, jose and ajv to a publicly reachable endpoint.
 */

/**
 * Newer hosts probe with a post-2025 discovery method before falling back to
 * the `initialize` handshake, and they only accept the fallback when the probe
 * looks like a genuinely 2025-era server. `MethodNotFound` is that signal;
 * answering an unknown method with anything else (in particular a protocol
 * version complaint) reads as a broken modern server instead, and the host
 * gives up rather than falling back. Unknown methods must keep returning
 * -32601 unchanged.
 */
export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-06-18",
  "2025-03-26",
] as const;

export const MCP_SERVER_INFO = {
  name: "playrunner",
  title: "Playrunner",
  version: "1",
} as const;

export const JSON_RPC_INVALID_REQUEST = -32600;
export const JSON_RPC_METHOD_NOT_FOUND = -32601;
export const JSON_RPC_INTERNAL_ERROR = -32603;

export const MAX_MCP_BODY_BYTES = 131_072;
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export type JsonRpcId = string | number | null;

export type McpRequest = {
  id: JsonRpcId;
  isNotification: boolean;
  method: string;
  params: Record<string, unknown>;
};

const limitProperty = {
  type: "integer",
  minimum: 1,
  maximum: MAX_PAGE_SIZE,
  description: `Maximum results to return (default ${DEFAULT_PAGE_SIZE}).`,
} as const;

export const MCP_TOOLS = [
  {
    name: "list_workflows",
    title: "List workflows",
    description:
      "List the saved Playrunner workflows this token is allowed to run. Call this before run_workflow: an agent cannot run a workflow whose id it does not know.",
    inputSchema: {
      type: "object",
      properties: { limit: limitProperty },
      additionalProperties: false,
    },
  },
  {
    name: "run_workflow",
    title: "Run a workflow",
    description:
      "Start a saved Playrunner workflow. Returns an execution id immediately without waiting for the run to finish. Runs consume the account quota, so do not retry a call that already returned an execution id.",
    inputSchema: {
      type: "object",
      properties: {
        workflowId: {
          type: "string",
          description: "Workflow id from list_workflows.",
        },
        inputs: {
          type: "object",
          description: "Optional run inputs passed through to the workflow.",
          additionalProperties: true,
        },
        idempotencyKey: {
          type: "string",
          maxLength: 200,
          description:
            "Optional key that makes a repeated call return the original run instead of starting a second one.",
        },
      },
      required: ["workflowId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_run_status",
    title: "Get run status",
    description:
      "Read the current status of one run. Cheap enough to poll, but leave a few seconds between calls.",
    inputSchema: {
      type: "object",
      properties: {
        workflowId: { type: "string" },
        executionId: { type: "string" },
      },
      required: ["workflowId", "executionId"],
      additionalProperties: false,
    },
  },
  {
    name: "list_runs",
    title: "List recent runs",
    description:
      "List recent runs of one workflow, newest first. Use this to answer questions like whether last night’s run passed.",
    inputSchema: {
      type: "object",
      properties: { workflowId: { type: "string" }, limit: limitProperty },
      required: ["workflowId"],
      additionalProperties: false,
    },
  },
] as const;

export function jsonRpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}

export function jsonRpcFailure(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id, error: { code, message } };
}

/**
 * A tool that fails for an expected reason (unknown workflow, exhausted quota)
 * reports it as a successful JSON-RPC result carrying `isError`, so the calling
 * model can read and act on the reason. Only protocol-level faults are
 * JSON-RPC errors.
 */
export function toolFailure(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

export function toolSuccess(structuredContent: Record<string, unknown>) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(structuredContent) },
    ],
    structuredContent,
    isError: false,
  };
}

export function parseMcpRequest(
  body: unknown,
): { request: McpRequest } | { failure: ReturnType<typeof jsonRpcFailure> } {
  if (Array.isArray(body)) {
    return {
      failure: jsonRpcFailure(
        null,
        JSON_RPC_INVALID_REQUEST,
        "Batched JSON-RPC requests are not supported.",
      ),
    };
  }
  if (typeof body !== "object" || body === null) {
    return {
      failure: jsonRpcFailure(
        null,
        JSON_RPC_INVALID_REQUEST,
        "Request body must be a JSON-RPC 2.0 object.",
      ),
    };
  }
  const message = body as Record<string, unknown>;
  const id =
    typeof message.id === "string" ||
    (typeof message.id === "number" && Number.isFinite(message.id))
      ? (message.id as string | number)
      : null;
  if (message.jsonrpc !== "2.0") {
    return {
      failure: jsonRpcFailure(
        id,
        JSON_RPC_INVALID_REQUEST,
        "Only JSON-RPC 2.0 is supported.",
      ),
    };
  }
  if (typeof message.method !== "string" || !message.method) {
    return {
      failure: jsonRpcFailure(
        id,
        JSON_RPC_INVALID_REQUEST,
        "Request is missing a method.",
      ),
    };
  }
  const params =
    typeof message.params === "object" &&
    message.params !== null &&
    !Array.isArray(message.params)
      ? (message.params as Record<string, unknown>)
      : {};
  return {
    request: {
      id,
      isNotification: !("id" in message) || message.id === null,
      method: message.method,
      params,
    },
  };
}

export function negotiateProtocolVersion(requested: unknown): string {
  return typeof requested === "string" &&
    (MCP_SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : MCP_PROTOCOL_VERSION;
}

export function initializeResult(params: Record<string, unknown>) {
  return {
    protocolVersion: negotiateProtocolVersion(params.protocolVersion),
    capabilities: { tools: { listChanged: false } },
    serverInfo: MCP_SERVER_INFO,
    instructions:
      "Call list_workflows to discover runnable workflows, then run_workflow to start one. run_workflow returns immediately with an execution id; poll get_run_status for the outcome.",
  };
}

export function parseLimit(value: unknown) {
  if (value === undefined) return { limit: DEFAULT_PAGE_SIZE };
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_PAGE_SIZE
  ) {
    return {
      error: `limit must be an integer between 1 and ${MAX_PAGE_SIZE}.`,
    };
  }
  return { limit: value };
}

export function parseWorkflowId(args: Record<string, unknown>) {
  const workflowId = args.workflowId;
  if (typeof workflowId !== "string" || !workflowId.trim()) {
    return { error: "workflowId is required." };
  }
  return { workflowId: workflowId.trim() };
}

export function parseRunWorkflowArguments(args: Record<string, unknown>) {
  const workflow = parseWorkflowId(args);
  if ("error" in workflow) return workflow;
  const inputs = args.inputs;
  if (
    inputs !== undefined &&
    (typeof inputs !== "object" || inputs === null || Array.isArray(inputs))
  ) {
    return { error: "inputs must be an object." };
  }
  const idempotencyKey = args.idempotencyKey;
  if (
    idempotencyKey !== undefined &&
    (typeof idempotencyKey !== "string" || idempotencyKey.length > 200)
  ) {
    return {
      error: "idempotencyKey must be a string of at most 200 characters.",
    };
  }
  return {
    idempotencyKey: idempotencyKey?.trim() || undefined,
    inputs: (inputs as Record<string, unknown> | undefined) ?? {},
    workflowId: workflow.workflowId,
  };
}

export function parseGetRunStatusArguments(args: Record<string, unknown>) {
  const workflow = parseWorkflowId(args);
  if ("error" in workflow) return workflow;
  const executionId = args.executionId;
  if (typeof executionId !== "string" || !executionId.trim()) {
    return { error: "executionId is required." };
  }
  return { executionId: executionId.trim(), workflowId: workflow.workflowId };
}
