import crypto from 'node:crypto';
import express, { Router } from 'express';
import { requireApiToken } from '../auth/api-token.middleware';
import { getPublicApiBaseUrl } from '../config';
import { prisma } from '../lib/prisma';
import { tokenCanExecuteWorkflow } from '../services/api-tokens';

/**
 * Model Context Protocol surface (`POST /mcp`).
 *
 * Stateless Streamable HTTP: every request carries its own `Authorization:
 * Bearer pr_live_…` and no session is retained between calls. That is what MCP
 * hosts which store a static token per server expect, and it keeps this
 * endpoint inside the existing API-token auth and rate-limit model rather than
 * introducing a second one.
 *
 * The protocol is implemented directly rather than via `@modelcontextprotocol/sdk`
 * because a stateless tools-only server needs `initialize`, `tools/list` and
 * `tools/call` and nothing else, while the SDK would add express 5, hono, jose
 * and ajv to a publicly reachable endpoint. See `MCP_PROTOCOL_VERSION` for the
 * one behaviour that is deliberate rather than incidental.
 */

/**
 * Newer hosts probe with a post-2025 discovery method before falling back to
 * the `initialize` handshake, and they only accept the fallback when the probe
 * looks like a genuinely 2025-era server. `MethodNotFound` is that signal;
 * answering an unknown method with anything else (in particular a protocol
 * version complaint) reads as a broken modern server instead, and the host
 * gives up rather than falling back. This is why unknown methods must keep
 * returning -32601 unchanged.
 */
export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = [
  '2025-06-18',
  '2025-03-26',
] as const;

export const MCP_SERVER_INFO = {
  name: 'playrunner',
  title: 'Playrunner',
  version: '1',
} as const;

export const JSON_RPC_PARSE_ERROR = -32700;
export const JSON_RPC_INVALID_REQUEST = -32600;
export const JSON_RPC_METHOD_NOT_FOUND = -32601;
export const JSON_RPC_INVALID_PARAMS = -32602;
export const JSON_RPC_INTERNAL_ERROR = -32603;

export const MAX_MCP_BODY_BYTES = 131_072;
export const DEFAULT_WORKFLOW_PAGE_SIZE = 50;
export const MAX_WORKFLOW_PAGE_SIZE = 200;

export type JsonRpcId = string | number | null;

export type McpRequest = {
  id: JsonRpcId;
  isNotification: boolean;
  method: string;
  params: Record<string, unknown>;
};

export const MCP_TOOLS = [
  {
    name: 'list_workflows',
    title: 'List workflows',
    description:
      'List the saved Playrunner workflows this API token is allowed to run. Call this before run_workflow: an agent cannot run a workflow whose id it does not know.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_WORKFLOW_PAGE_SIZE,
          description: `Maximum workflows to return (default ${DEFAULT_WORKFLOW_PAGE_SIZE}).`,
        },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        workflows: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              project: { type: ['string', 'null'] },
              updatedAt: { type: 'string' },
            },
            required: ['id', 'title', 'project', 'updatedAt'],
          },
        },
      },
      required: ['workflows'],
    },
  },
  {
    name: 'run_workflow',
    title: 'Run a workflow',
    description:
      'Start a saved Playrunner workflow. Returns an execution id immediately without waiting for the run to finish. Runs consume the account quota, so do not retry a call that already returned an execution id.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description: 'Workflow id from list_workflows.',
        },
        inputs: {
          type: 'object',
          description: 'Optional run inputs passed through to the workflow.',
          additionalProperties: true,
        },
        idempotencyKey: {
          type: 'string',
          maxLength: 200,
          description:
            'Optional key that makes a repeated call return the original run instead of starting a second one.',
        },
      },
      required: ['workflowId'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        executionId: { type: 'string' },
        status: { type: 'string' },
        workflowId: { type: 'string' },
      },
      required: ['executionId', 'status', 'workflowId'],
    },
  },
] as const;

export function jsonRpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: '2.0' as const, id, result };
}

export function jsonRpcFailure(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
) {
  return {
    jsonrpc: '2.0' as const,
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

/**
 * A tool that fails for an expected reason (unknown workflow, exhausted quota)
 * reports it as a successful JSON-RPC result carrying `isError`, so the calling
 * model can read and act on the reason. Only protocol-level faults are
 * JSON-RPC errors.
 */
export function toolFailure(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

export function toolSuccess(structuredContent: Record<string, unknown>) {
  return {
    content: [
      { type: 'text' as const, text: JSON.stringify(structuredContent) },
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
        'Batched JSON-RPC requests are not supported.',
      ),
    };
  }
  if (typeof body !== 'object' || body === null) {
    return {
      failure: jsonRpcFailure(
        null,
        JSON_RPC_INVALID_REQUEST,
        'Request body must be a JSON-RPC 2.0 object.',
      ),
    };
  }
  const message = body as Record<string, unknown>;
  const id =
    typeof message.id === 'string' ||
    (typeof message.id === 'number' && Number.isFinite(message.id))
      ? (message.id as string | number)
      : null;
  if (message.jsonrpc !== '2.0') {
    return {
      failure: jsonRpcFailure(
        id,
        JSON_RPC_INVALID_REQUEST,
        'Only JSON-RPC 2.0 is supported.',
      ),
    };
  }
  if (typeof message.method !== 'string' || !message.method) {
    return {
      failure: jsonRpcFailure(
        id,
        JSON_RPC_INVALID_REQUEST,
        'Request is missing a method.',
      ),
    };
  }
  const params =
    typeof message.params === 'object' &&
    message.params !== null &&
    !Array.isArray(message.params)
      ? (message.params as Record<string, unknown>)
      : {};
  return {
    request: {
      id,
      isNotification: !('id' in message) || message.id === null,
      method: message.method,
      params,
    },
  };
}

export function negotiateProtocolVersion(requested: unknown): string {
  return typeof requested === 'string' &&
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
      'Call list_workflows to discover runnable workflows, then run_workflow to start one. run_workflow returns immediately with an execution id; it does not wait for the run to finish.',
  };
}

export function parseListWorkflowsArguments(args: Record<string, unknown>) {
  const limit = args.limit;
  if (limit === undefined) return { limit: DEFAULT_WORKFLOW_PAGE_SIZE };
  if (
    typeof limit !== 'number' ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_WORKFLOW_PAGE_SIZE
  ) {
    return {
      error: `limit must be an integer between 1 and ${MAX_WORKFLOW_PAGE_SIZE}.`,
    };
  }
  return { limit };
}

export function parseRunWorkflowArguments(args: Record<string, unknown>) {
  const workflowId = args.workflowId;
  if (typeof workflowId !== 'string' || !workflowId.trim()) {
    return { error: 'workflowId is required.' };
  }
  const inputs = args.inputs;
  if (
    inputs !== undefined &&
    (typeof inputs !== 'object' || inputs === null || Array.isArray(inputs))
  ) {
    return { error: 'inputs must be an object.' };
  }
  const idempotencyKey = args.idempotencyKey;
  if (
    idempotencyKey !== undefined &&
    (typeof idempotencyKey !== 'string' || idempotencyKey.length > 200)
  ) {
    return {
      error: 'idempotencyKey must be a string of at most 200 characters.',
    };
  }
  return {
    idempotencyKey: idempotencyKey?.trim() || crypto.randomUUID(),
    inputs: (inputs as Record<string, unknown> | undefined) ?? {},
    workflowId: workflowId.trim(),
  };
}

/**
 * `run_workflow` starts runs by re-issuing the caller's request against the
 * public machine-execution endpoint rather than starting one itself.
 *
 * On cloud, run metering lives in the gateway that fronts this service, keyed
 * off a fixed list of request paths. A run started in-process — or through a
 * loopback address that skips the gateway — would not be counted against the
 * account's quota at all. Going back out through the public base URL means the
 * run is metered because it *is* an `/api/v1/workflows/:id/executions` request,
 * not because anything here remembered to meter it.
 */
export function runWorkflowDispatch(params: {
  authorization: string;
  baseUrl: string;
  idempotencyKey: string;
  inputs: Record<string, unknown>;
  workflowId: string;
}) {
  const base = params.baseUrl.replace(/\/+$/, '');
  return {
    init: {
      body: JSON.stringify(
        Object.keys(params.inputs).length ? { inputs: params.inputs } : {},
      ),
      headers: {
        authorization: params.authorization,
        'content-type': 'application/json',
        'idempotency-key': params.idempotencyKey,
      },
      method: 'POST' as const,
    },
    url: `${base}/api/v1/workflows/${encodeURIComponent(params.workflowId)}/executions`,
  };
}

export function interpretRunWorkflowResponse(
  status: number,
  body: unknown,
  workflowId: string,
) {
  const payload =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const message =
    typeof payload.error === 'string' ? payload.error : 'Unknown error.';

  if (status === 202 || status === 200) {
    return toolSuccess({
      executionId: String(payload.executionId ?? ''),
      status: String(payload.status ?? 'running'),
      workflowId,
      ...(payload.deduplicated === true ? { deduplicated: true } : {}),
    });
  }
  if (status === 402) {
    return toolFailure(
      `${message} Ask the account owner to review the Playrunner Cloud plan; retrying will not help.`,
    );
  }
  if (status === 404) {
    return toolFailure(
      `Workflow ${workflowId} was not found, or this token is not allowed to run it. Call list_workflows for runnable workflows.`,
    );
  }
  if (status === 429) {
    return toolFailure('Rate limited by Playrunner. Retry in a minute.');
  }
  return toolFailure(
    `Workflow could not be started (HTTP ${status}). ${message}`,
  );
}

export const mcpRouter = Router();
mcpRouter.use(requireApiToken);
mcpRouter.use(express.json({ limit: MAX_MCP_BODY_BYTES }));

mcpRouter.post('/', async (req, res) => {
  const parsed = parseMcpRequest(req.body);
  if ('failure' in parsed) {
    res.status(400).json(parsed.failure);
    return;
  }
  const { id, isNotification, method, params } = parsed.request;

  // Notifications carry no id and must not be answered with a JSON-RPC body.
  if (isNotification) {
    res.status(202).end();
    return;
  }

  try {
    if (method === 'initialize') {
      res.json(jsonRpcResult(id, initializeResult(params)));
      return;
    }
    if (method === 'ping') {
      res.json(jsonRpcResult(id, {}));
      return;
    }
    if (method === 'tools/list') {
      res.json(jsonRpcResult(id, { tools: MCP_TOOLS }));
      return;
    }
    if (method === 'tools/call') {
      res.json(jsonRpcResult(id, await callTool(req, params)));
      return;
    }
    res.json(
      jsonRpcFailure(
        id,
        JSON_RPC_METHOD_NOT_FOUND,
        `Unknown method: ${method}`,
      ),
    );
  } catch (error) {
    console.error('MCP request failed:', error);
    res
      .status(500)
      .json(jsonRpcFailure(id, JSON_RPC_INTERNAL_ERROR, 'Internal error.'));
  }
});

// Stateless: there is no server-initiated stream and no session to delete.
mcpRouter.all('/', (_req, res) => {
  res.set('Allow', 'POST');
  res
    .status(405)
    .json(
      jsonRpcFailure(
        null,
        JSON_RPC_INVALID_REQUEST,
        'This MCP endpoint accepts POST only.',
      ),
    );
});

async function callTool(
  req: Parameters<typeof requireApiToken>[0],
  params: Record<string, unknown>,
) {
  const token = req.apiToken!;
  const name = params.name;
  const args =
    typeof params.arguments === 'object' &&
    params.arguments !== null &&
    !Array.isArray(params.arguments)
      ? (params.arguments as Record<string, unknown>)
      : {};

  if (name === 'list_workflows') {
    const parsedArgs = parseListWorkflowsArguments(args);
    if ('error' in parsedArgs) return toolFailure(parsedArgs.error);
    const workflows = await prisma.workflow.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        updatedAt: true,
        project: { select: { title: true } },
      },
      take: parsedArgs.limit,
      where: { userId: token.userId },
    });
    return toolSuccess({
      workflows: workflows
        .filter((workflow) => tokenCanExecuteWorkflow(token, workflow.id))
        .map((workflow) => ({
          id: workflow.id,
          project: workflow.project?.title ?? null,
          title: workflow.title || 'Untitled Workflow',
          updatedAt: workflow.updatedAt.toISOString(),
        })),
    });
  }

  if (name === 'run_workflow') {
    const parsedArgs = parseRunWorkflowArguments(args);
    if ('error' in parsedArgs) return toolFailure(parsedArgs.error);
    const dispatch = runWorkflowDispatch({
      authorization: req.headers.authorization!,
      baseUrl: getPublicApiBaseUrl(req),
      idempotencyKey: parsedArgs.idempotencyKey,
      inputs: parsedArgs.inputs,
      workflowId: parsedArgs.workflowId,
    });
    const response = await fetch(dispatch.url, dispatch.init);
    const body = await response.json().catch(() => ({}));
    return interpretRunWorkflowResponse(
      response.status,
      body,
      parsedArgs.workflowId,
    );
  }

  return toolFailure(`Unknown tool: ${String(name)}`);
}
