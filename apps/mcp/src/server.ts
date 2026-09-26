import express, { type Request, type Response } from "express";
import {
  callMachineApi,
  interpretListResponse,
  interpretMutationResponse,
  interpretRunWorkflowResponse,
  machineRequest,
} from "./playrunner-client";
import {
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  MAX_MCP_BODY_BYTES,
  MCP_TOOLS,
  initializeResult,
  jsonRpcFailure,
  jsonRpcResult,
  parseGetRunStatusArguments,
  parseLimit,
  parseMcpRequest,
  parseRunWorkflowArguments,
  parseWorkflowId,
  toolFailure,
} from "./protocol";

export function bearerAuthorization(req: Request) {
  const authorization = req.headers.authorization;
  return authorization?.startsWith("Bearer ") && authorization.length > 7
    ? authorization
    : null;
}

export async function callTool(
  authorization: string,
  params: Record<string, unknown>,
) {
  const name = params.name;
  const args =
    typeof params.arguments === "object" &&
    params.arguments !== null &&
    !Array.isArray(params.arguments)
      ? (params.arguments as Record<string, unknown>)
      : {};

  if (name === "list_projects") {
    const limit = parseLimit(args.limit);
    if ("error" in limit) return toolFailure(limit.error);
    return interpretListResponse(
      await callMachineApi(
        machineRequest({
          authorization,
          method: "GET",
          path: "/api/v1/projects",
          query: { limit: limit.limit },
        }),
      ),
      { notFound: "No projects available to this management key." },
    );
  }
  if (name === "delete_project" || name === "delete_workflow") {
    const field = name === "delete_project" ? "projectId" : "workflowId";
    const id = args[field];
    if (typeof id !== "string" || !id.trim())
      return toolFailure(`${field} is required.`);
    const kind = name === "delete_project" ? "projects" : "workflows";
    return interpretMutationResponse(
      await callMachineApi(
        machineRequest({
          authorization,
          method: "DELETE",
          path: `/api/v1/${kind}/${encodeURIComponent(id.trim())}`,
        }),
      ),
    );
  }
  if (name === "save_workflow") {
    const definition = args.definition as
      | { workflow?: { key?: unknown } }
      | undefined;
    const key = definition?.workflow?.key;
    if (
      typeof key !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(key)
    )
      return toolFailure(
        "definition.workflow.key is required and must be a valid workflow key.",
      );
    return interpretMutationResponse(
      await callMachineApi(
        machineRequest({
          authorization,
          method: "PUT",
          path: `/api/v1/workflows/definitions/${encodeURIComponent(key)}`,
          payload: definition,
        }),
      ),
    );
  }
  if (name === "get_run_events") {
    const parsed = parseGetRunStatusArguments(args);
    if ("error" in parsed) return toolFailure(parsed.error);
    const after = args.after ?? "0";
    if (typeof after !== "string" || !/^\d+$/.test(after))
      return toolFailure("after must be a non-negative integer string.");
    return interpretListResponse(
      await callMachineApi(
        machineRequest({
          authorization,
          method: "GET",
          path: `/api/v1/workflows/${encodeURIComponent(parsed.workflowId)}/executions/${encodeURIComponent(parsed.executionId)}/events`,
          query: { after },
        }),
      ),
      { notFound: "Workflow execution not found." },
    );
  }

  if (name === "list_workflows") {
    const limit = parseLimit(args.limit);
    if ("error" in limit) return toolFailure(limit.error);
    const response = await callMachineApi(
      machineRequest({
        authorization,
        method: "GET",
        path: "/api/v1/workflows",
        query: { limit: limit.limit },
      }),
    );
    return interpretListResponse(response, {
      notFound: "No Playrunner workflows are available to this token.",
    });
  }

  if (name === "run_workflow") {
    const parsed = parseRunWorkflowArguments(args);
    if ("error" in parsed) return toolFailure(parsed.error);
    const response = await callMachineApi(
      machineRequest({
        authorization,
        idempotencyKey: parsed.idempotencyKey,
        method: "POST",
        path: `/api/v1/workflows/${encodeURIComponent(parsed.workflowId)}/executions`,
        payload: {
          ...parsed.changeContext,
          ...(Object.keys(parsed.inputs).length
            ? { inputs: parsed.inputs }
            : {}),
          ...(parsed.acceptanceCriteria === undefined
            ? {}
            : { acceptanceCriteria: parsed.acceptanceCriteria }),
        },
      }),
    );
    return interpretRunWorkflowResponse(response, parsed.workflowId);
  }

  if (name === "get_run_status") {
    const parsed = parseGetRunStatusArguments(args);
    if ("error" in parsed) return toolFailure(parsed.error);
    const response = await callMachineApi(
      machineRequest({
        authorization,
        method: "GET",
        path: `/api/v1/workflows/${encodeURIComponent(parsed.workflowId)}/executions/${encodeURIComponent(parsed.executionId)}`,
      }),
    );
    return interpretListResponse(response, {
      notFound: `Run ${parsed.executionId} was not found for workflow ${parsed.workflowId}.`,
    });
  }

  if (name === "list_runs") {
    const workflow = parseWorkflowId(args);
    if ("error" in workflow) return toolFailure(workflow.error);
    const limit = parseLimit(args.limit);
    if ("error" in limit) return toolFailure(limit.error);
    const response = await callMachineApi(
      machineRequest({
        authorization,
        method: "GET",
        path: `/api/v1/workflows/${encodeURIComponent(workflow.workflowId)}/executions`,
        query: { limit: limit.limit },
      }),
    );
    return interpretListResponse(response, {
      notFound: `Workflow ${workflow.workflowId} was not found, or this token is not allowed to read it.`,
    });
  }

  return toolFailure(`Unknown tool: ${String(name)}`);
}

export async function handleMcpPost(req: Request, res: Response) {
  const authorization = bearerAuthorization(req);
  if (!authorization) {
    // Hosts treat 401 as "this server wants credentials", which is the signal
    // that starts their auth flow rather than a hard failure.
    res.set("WWW-Authenticate", "Bearer");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = parseMcpRequest(req.body);
  if ("failure" in parsed) {
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
    if (method === "initialize") {
      res.json(jsonRpcResult(id, initializeResult(params)));
      return;
    }
    if (method === "ping") {
      res.json(jsonRpcResult(id, {}));
      return;
    }
    if (method === "tools/list") {
      res.json(jsonRpcResult(id, { tools: MCP_TOOLS }));
      return;
    }
    if (method === "tools/call") {
      res.json(jsonRpcResult(id, await callTool(authorization, params)));
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
    console.error("MCP request failed:", error);
    res
      .status(500)
      .json(jsonRpcFailure(id, JSON_RPC_INTERNAL_ERROR, "Internal error."));
  }
}

export function createMcpApp() {
  const app = express();
  app.get("/health", (_req, res) => {
    res.status(200).send("OK");
  });
  app.use("/mcp", express.json({ limit: MAX_MCP_BODY_BYTES }));
  app.post("/mcp", handleMcpPost);
  // Stateless: there is no server-initiated stream and no session to delete.
  app.all("/mcp", (_req, res) => {
    res.set("Allow", "POST");
    res
      .status(405)
      .json(
        jsonRpcFailure(
          null,
          JSON_RPC_INVALID_REQUEST,
          "This MCP endpoint accepts POST only.",
        ),
      );
  });
  return app;
}
