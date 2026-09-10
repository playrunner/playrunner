import crypto from "node:crypto";
import { PLAYRUNNER_API_URL } from "./config";
import { toolFailure, toolSuccess } from "./protocol";

/**
 * Thin HTTP client over the Playrunner machine API.
 *
 * This server owns no data and no auth of its own: it forwards the caller's
 * API token and lets the API decide what that token may see. Run metering,
 * rate limiting, the `workflow:execute` scope check and per-token
 * `allowedWorkflowIds` all stay where they already live.
 */

export type PlayrunnerResponse = { body: unknown; status: number };

export function machineRequest(params: {
  authorization: string;
  idempotencyKey?: string;
  method: "GET" | "POST";
  path: string;
  payload?: unknown;
  query?: Record<string, string | number | undefined>;
}) {
  const url = new URL(`${PLAYRUNNER_API_URL}${params.path}`);
  for (const [key, value] of Object.entries(params.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const headers: Record<string, string> = {
    authorization: params.authorization,
  };
  if (params.method === "POST") {
    headers["content-type"] = "application/json";
    headers["idempotency-key"] = params.idempotencyKey || crypto.randomUUID();
  }
  return {
    init: {
      ...(params.method === "POST"
        ? { body: JSON.stringify(params.payload ?? {}) }
        : {}),
      headers,
      method: params.method,
    },
    url: url.toString(),
  };
}

export async function callMachineApi(
  request: ReturnType<typeof machineRequest>,
): Promise<PlayrunnerResponse> {
  const response = await fetch(request.url, request.init);
  const body = await response.json().catch(() => ({}));
  return { body, status: response.status };
}

function errorMessage(body: unknown) {
  return typeof body === "object" &&
    body !== null &&
    typeof (body as Record<string, unknown>).error === "string"
    ? ((body as Record<string, unknown>).error as string)
    : "Unknown error.";
}

/**
 * Failures an agent can act on are returned as readable tool errors rather
 * than raw status codes, so a model does not retry something that can never
 * succeed (an exhausted quota) or misread a scope denial as an outage.
 */
export function machineFailure(
  response: PlayrunnerResponse,
  context: { notFound: string },
) {
  const message = errorMessage(response.body);
  if (response.status === 401) {
    return toolFailure(
      "Playrunner rejected the API token. It may have been revoked or expired.",
    );
  }
  if (response.status === 402) {
    return toolFailure(
      `${message} Ask the account owner to review the Playrunner Cloud plan; retrying will not help.`,
    );
  }
  if (response.status === 404) {
    return toolFailure(context.notFound);
  }
  if (response.status === 429) {
    return toolFailure("Rate limited by Playrunner. Retry in a minute.");
  }
  return toolFailure(`Playrunner returned HTTP ${response.status}. ${message}`);
}

export function interpretRunWorkflowResponse(
  response: PlayrunnerResponse,
  workflowId: string,
) {
  const payload =
    typeof response.body === "object" && response.body !== null
      ? (response.body as Record<string, unknown>)
      : {};
  if (response.status === 202 || response.status === 200) {
    return toolSuccess({
      executionId: String(payload.executionId ?? ""),
      status: String(payload.status ?? "running"),
      workflowId,
      ...(payload.deduplicated === true ? { deduplicated: true } : {}),
    });
  }
  return machineFailure(response, {
    notFound: `Workflow ${workflowId} was not found, or this token is not allowed to run it. Call list_workflows for runnable workflows.`,
  });
}

export function interpretListResponse(
  response: PlayrunnerResponse,
  context: { notFound: string },
) {
  if (response.status === 200) {
    return toolSuccess((response.body ?? {}) as Record<string, unknown>);
  }
  return machineFailure(response, context);
}
