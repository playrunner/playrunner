import { WORKFLOW_EDITOR_URI } from "./workflow-editor";
/**
 * Stateless Streamable HTTP MCP protocol layer.
 *
 * Every request carries its own `Authorization: Bearer pr_live_…` and no
 * session is retained between calls, which is what MCP hosts that store a
 * static token per server expect.
 *
 * The protocol is implemented directly rather than via
 * `@modelcontextprotocol/sdk` to keep the stateless HTTP transport small. It exposes tools and the
 * versioned workflow editor resource without retaining user sessions.
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
  version: "2",
} as const;

export const JSON_RPC_INVALID_REQUEST = -32600;
export const JSON_RPC_METHOD_NOT_FOUND = -32601;
export const JSON_RPC_INTERNAL_ERROR = -32603;

// Workflow definitions are accepted up to 2 MiB by the machine API, plus the RPC envelope.
export const MAX_MCP_BODY_BYTES = 2 * 1024 * 1024 + 16_384;
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

const releaseCandidateProperty = {
  type: "object",
  description:
    "Exact release candidate expected by the protected release pipeline. Identity must be independently observed from the tested target.",
  properties: {
    repository: {
      type: "string",
      pattern:
        "^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$",
    },
    commitSha: {
      type: "string",
      pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$",
    },
    artifactDigest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    environment: {
      type: "string",
      pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$",
    },
    targetUrl: {
      type: "string",
      description: "HTTP(S) target URL without credentials, query or fragment.",
    },
  },
  required: [
    "repository",
    "commitSha",
    "artifactDigest",
    "environment",
    "targetUrl",
  ],
  additionalProperties: false,
} as const;

const releaseProperties = {
  candidate: releaseCandidateProperty,
  policyVersion: {
    type: "string",
    pattern: "^[0-9a-f]{64}$",
    description:
      "Expected policy hash pinned by the protected release pipeline, obtained from get_release_policy after review.",
  },
  maxAgeSeconds: {
    type: "integer",
    minimum: 1,
    maximum: 86400,
    description: "Maximum evidence age in seconds (default 3600).",
  },
} as const;

export const MCP_TOOLS = [
  {
    name: "get_authoring_guide",
    title: "Get workflow authoring guide",
    description:
      "Read the saved Playwright regression mapping, immutable run request and feedback contract before authoring change-aware test workflows.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  ...["open_workflow_editor", "get_workflow_editor"].map((name) => ({
    name,
    title:
      name === "open_workflow_editor"
        ? "Open workflow editor"
        : "Refresh workflow editor",
    description:
      name === "open_workflow_editor"
        ? "Show a live workflow canvas in the chat. Call immediately after the first save, then save incremental graph changes so the user can watch nodes appear."
        : "Read the latest saved graph for the open editor. Does not modify or run the workflow. Requires workflow:write management access.",
    inputSchema: {
      type: "object",
      properties: { workflowId: { type: "string", minLength: 1 } },
      required: ["workflowId"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    _meta:
      name === "open_workflow_editor"
        ? {
            ui: { resourceUri: WORKFLOW_EDITOR_URI },
            "openai/outputTemplate": WORKFLOW_EDITOR_URI,
          }
        : { ui: { visibility: ["app"] }, "openai/widgetAccessible": true },
  })),
  {
    name: "list_projects",
    title: "List projects",
    description:
      "List owned projects. Requires an unrestricted workflow:write key.",
    inputSchema: {
      type: "object",
      properties: { limit: limitProperty },
      additionalProperties: false,
    },
  },
  {
    name: "save_workflow",
    title: "Save a workflow",
    description:
      "Read get_authoring_guide before configuring regression mappings. After the first save call open_workflow_editor, then save incremental node additions to show progress. Create or update a workflow using a machine API definition with project and workflow keys, nodes, connections, cloudProvider, optional concurrency and testPlan. Requires unrestricted workflow:write. Keep secrets in environment references.",
    inputSchema: {
      type: "object",
      properties: {
        definition: {
          type: "object",
          required: ["project", "workflow"],
          properties: {
            project: { type: "object" },
            workflow: { type: "object" },
          },
        },
      },
      required: ["definition"],
      additionalProperties: false,
    },
  },
  ...(["project", "workflow"] as const).map((kind) => ({
    name: `delete_${kind}`,
    title: `Delete ${kind}`,
    description: `Permanently delete an owned ${kind}. Requires unrestricted workflow:write. Projects must be empty; workflows must have no active executions. Existing execution reports are retained.`,
    annotations: {
      destructiveHint: true,
      readOnlyHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: "object",
      properties: { [`${kind}Id`]: { type: "string", minLength: 1 } },
      required: [`${kind}Id`],
      additionalProperties: false,
    },
  })),
  {
    name: "get_run_events",
    title: "Get run events",
    description:
      "Read sanitized execution events after a cursor. Use event IDs as the next after value.",
    inputSchema: {
      type: "object",
      properties: {
        workflowId: { type: "string" },
        executionId: { type: "string" },
        after: { type: "string", pattern: "^[0-9]+$" },
      },
      required: ["workflowId", "executionId"],
      additionalProperties: false,
    },
  },
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
      "Start a saved Playrunner workflow. For release verification, pass release with the exact candidate and pinned policyVersion, then call get_release_verdict. Completion alone never allows a release. Returns an execution id immediately without waiting for the run to finish. Runs consume the account quota, so do not retry a call that already returned an execution id.",
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
        acceptanceCriteria: {
          anyOf: [
            { type: "string", maxLength: 4096 },
            {
              type: "array",
              maxItems: 20,
              items: { type: "string", maxLength: 4096 },
            },
          ],
          description: "Acceptance criteria supported by the workflow run API.",
        },
        changeContext: {
          type: "object",
          description:
            "Optional CI context: repository {owner,name}, baseSha, headSha, baseRef, headRef, eventType and optional pullRequestNumber. Validated by the machine API.",
        },
        regression: {
          type: "object",
          description:
            "Change-aware run request for saved Playwright config.regression. Provide version 1, mode affected or full, and sources with repository owner/name plus immutable baseSha/headSha. Cannot be combined with legacy changeContext or release. The runner computes changes and falls back to full testing when impact is uncertain.",
          properties: {
            version: { type: "integer", const: 1 },
            mode: { type: "string", enum: ["affected", "full"] },
            sources: {
              type: "array",
              minItems: 1,
              maxItems: 16,
              items: {
                type: "object",
                properties: {
                  repository: { type: "string" },
                  baseSha: { type: "string", pattern: "^[a-fA-F0-9]{40}$" },
                  headSha: { type: "string", pattern: "^[a-fA-F0-9]{40}$" },
                },
                required: ["repository", "baseSha", "headSha"],
                additionalProperties: false,
              },
            },
          },
          required: ["version", "mode", "sources"],
          additionalProperties: false,
        },
        release: {
          type: "object",
          description:
            "Bind verification to the exact release candidate and reviewed policy. Cannot be combined with changeContext, nonempty inputs or acceptanceCriteria. Configuration and requirements must be saved in the pinned workflow.",
          properties: releaseProperties,
          required: ["candidate", "policyVersion"],
          additionalProperties: false,
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
    name: "get_release_policy",
    title: "Get release policy",
    description:
      "Read a saved workflow's release requirements and policyVersion. The saved test plan must map RELEASE_IDENTITY to exactly one node and contain at least one other requirement. The successful identity node must emit output.releaseCandidate observed from the target, never copied from the request. Release checks support Environment, Playwright, JavaScript and Webhook nodes. Repository test sources require a full commit SHA in branch; mutable workspaces and AI generation are unsupported. The policy pins the test plan, nodes, connections, linked environment values and secret revisions. A protected release pipeline must pin the reviewed policyVersion. Playwright receives BASE_URL and RELEASE_REPOSITORY, RELEASE_COMMIT_SHA, RELEASE_ARTIFACT_DIGEST, RELEASE_ENVIRONMENT and RELEASE_TARGET_URL from the candidate.",
    inputSchema: {
      type: "object",
      properties: { workflowId: { type: "string", minLength: 1 } },
      required: ["workflowId"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "get_release_verdict",
    title: "Get release verdict",
    description:
      "Evaluate execution evidence against the expected candidate and pinned policyVersion. Only status PASS with allowed true for that exact candidate and policy permits release. FAIL or BLOCKED forbids release; completed run status alone is insufficient. Call again immediately before release to check evidence freshness and policy changes. This reads evidence and does not start a run or deploy anything.",
    inputSchema: {
      type: "object",
      properties: {
        workflowId: { type: "string", minLength: 1 },
        executionId: { type: "string", minLength: 1 },
        ...releaseProperties,
      },
      required: ["workflowId", "executionId", "candidate", "policyVersion"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "get_run_feedback",
    title: "Get run feedback",
    description:
      "Read compact progress, selected journeys, final failures and authenticated report paths for an existing execution. Never starts another run. Pass nextCursor as after; drain while hasMore. Truncated or incomplete evidence is not a passing result. A failing head run alone is not a confirmed regression against baseline.",
    inputSchema: {
      type: "object",
      properties: {
        workflowId: { type: "string", minLength: 1 },
        executionId: { type: "string", minLength: 1 },
        after: { type: "string", pattern: "^[0-9]{1,19}$" },
      },
      required: ["workflowId", "executionId"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
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
    capabilities: {
      tools: { listChanged: false },
      resources: { listChanged: false },
    },
    serverInfo: MCP_SERVER_INFO,
    instructions:
      "Call list_workflows to discover runnable workflows, then run_workflow to start one. run_workflow returns immediately with an execution id; poll get_run_status for the outcome. Before release, read get_release_policy and use the protected pipeline's reviewed, pinned policyVersion plus exact candidate when calling run_workflow with release. The saved test plan must map RELEASE_IDENTITY to exactly one node that emits output.releaseCandidate observed from the target, never copied from the request, and include at least one other requirement. Call get_release_verdict for that execution with the expected candidate and policyVersion immediately before release. Only PASS with allowed true for the matching candidate and policy allows release; completion alone never does. FAIL, BLOCKED, missing evidence or an unavailable verdict must block release.",
  };
}

export function parseLimit(
  value: unknown,
): { error: string } | { limit: number } {
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

export function parseWorkflowId(
  args: Record<string, unknown>,
): { error: string } | { workflowId: string } {
  const workflowId = args.workflowId;
  if (typeof workflowId !== "string" || !workflowId.trim()) {
    return { error: "workflowId is required." };
  }
  return { workflowId: workflowId.trim() };
}

export function parseRunWorkflowArguments(args: Record<string, unknown>):
  | { error: string }
  | {
      workflowId: string;
      idempotencyKey?: string;
      inputs: Record<string, unknown>;
      acceptanceCriteria?: string | string[];
      changeContext?: Record<string, unknown>;
      regression?: Record<string, unknown>;
      release?: ReleaseArguments;
    } {
  const workflow = parseWorkflowId(args);
  if ("error" in workflow) return workflow;
  const inputs = args.inputs;
  if (
    inputs !== undefined &&
    (typeof inputs !== "object" || inputs === null || Array.isArray(inputs))
  ) {
    return { error: "inputs must be an object." };
  }
  const acceptanceCriteria = args.acceptanceCriteria;
  if (
    acceptanceCriteria !== undefined &&
    !(
      typeof acceptanceCriteria === "string" ||
      (Array.isArray(acceptanceCriteria) &&
        acceptanceCriteria.length <= 20 &&
        acceptanceCriteria.every(
          (item) => typeof item === "string" && item.length <= 4096,
        ))
    )
  )
    return {
      error: "acceptanceCriteria must be a string or at most 20 strings.",
    };
  if (
    typeof acceptanceCriteria === "string" &&
    acceptanceCriteria.length > 4096
  )
    return { error: "acceptanceCriteria exceeds 4096 characters." };
  const changeContext = args.changeContext;
  const regression = args.regression;
  if (regression !== undefined) {
    if (args.release !== undefined || changeContext !== undefined)
      return {
        error: "regression cannot be combined with release or changeContext.",
      };
    if (
      !regression ||
      typeof regression !== "object" ||
      Array.isArray(regression)
    )
      return { error: "regression must be an object." };
    const value = regression as Record<string, unknown>;
    if (
      Object.keys(value).some(
        (key) => !["version", "mode", "sources"].includes(key),
      ) ||
      value.version !== 1 ||
      !["affected", "full"].includes(String(value.mode)) ||
      !Array.isArray(value.sources) ||
      value.sources.length < 1 ||
      value.sources.length > 16
    )
      return {
        error:
          "regression requires version 1, mode affected or full, and 1–16 sources.",
      };
    if (
      value.sources.some(
        (source) =>
          !source ||
          typeof source !== "object" ||
          Array.isArray(source) ||
          Object.keys(source).some(
            (key) => !["repository", "baseSha", "headSha"].includes(key),
          ) ||
          typeof source.repository !== "string" ||
          source.repository.length > 200 ||
          !/^[a-fA-F0-9]{40}$/.test(source.baseSha) ||
          !/^[a-fA-F0-9]{40}$/.test(source.headSha),
      )
    )
      return {
        error:
          "Each regression source requires repository and immutable 40-character baseSha/headSha.",
      };
    // Full repository/policy validation remains authoritative in the API.
  }
  if (args.release !== undefined && changeContext !== undefined)
    return { error: "release cannot be combined with changeContext." };
  if (
    args.release !== undefined &&
    (Object.keys(inputs ?? {}).length ||
      typeof acceptanceCriteria === "string" ||
      (Array.isArray(acceptanceCriteria) && acceptanceCriteria.length))
  )
    return {
      error:
        "Release configuration and requirements must be saved in the pinned workflow; do not pass inputs or acceptanceCriteria.",
    };
  if (
    changeContext !== undefined &&
    (!changeContext ||
      typeof changeContext !== "object" ||
      Array.isArray(changeContext) ||
      Object.keys(changeContext).some(
        (key) =>
          ![
            "repository",
            "baseSha",
            "headSha",
            "baseRef",
            "headRef",
            "eventType",
            "pullRequestNumber",
          ].includes(key),
      ))
  )
    return { error: "changeContext contains unsupported fields." };
  const idempotencyKey = args.idempotencyKey;
  if (
    idempotencyKey !== undefined &&
    (typeof idempotencyKey !== "string" || idempotencyKey.length > 200)
  ) {
    return {
      error: "idempotencyKey must be a string of at most 200 characters.",
    };
  }
  const release =
    args.release === undefined
      ? undefined
      : parseReleaseArguments(args.release);
  if (release && "error" in release) return release;
  return {
    ...(regression === undefined
      ? {}
      : { regression: regression as Record<string, unknown> }),
    ...(release === undefined ? {} : { release }),
    ...(acceptanceCriteria === undefined ? {} : { acceptanceCriteria }),
    ...(changeContext === undefined
      ? {}
      : { changeContext: changeContext as Record<string, unknown> }),
    idempotencyKey: idempotencyKey?.trim() || undefined,
    inputs: (inputs as Record<string, unknown> | undefined) ?? {},
    workflowId: workflow.workflowId,
  };
}

type ReleaseArguments = {
  candidate: {
    repository: string;
    commitSha: string;
    artifactDigest: string;
    environment: string;
    targetUrl: string;
  };
  policyVersion: string;
  maxAgeSeconds?: number;
};

// This is a transport shape check; the machine API remains authoritative for
// candidate validation, access control and release eligibility.
function parseReleaseArguments(
  value: unknown,
): { error: string } | ReleaseArguments {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return { error: "release must be an object." };
  const release = value as Record<string, unknown>;
  if (
    Object.keys(release).some(
      (key) => !["candidate", "policyVersion", "maxAgeSeconds"].includes(key),
    )
  )
    return { error: "release contains unsupported fields." };
  const candidate = release.candidate;
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate)
  )
    return { error: "release.candidate must be an object." };
  const fields = releaseCandidateProperty.required;
  const values = candidate as Record<string, unknown>;
  if (
    fields.some((key) => typeof values[key] !== "string" || !values[key]) ||
    Object.keys(values).some(
      (key) => !(fields as readonly string[]).includes(key),
    )
  )
    return {
      error:
        "release.candidate requires repository, commitSha, artifactDigest, environment and targetUrl string fields only.",
    };
  for (const [key, pattern] of [
    ["repository", releaseCandidateProperty.properties.repository.pattern],
    ["commitSha", releaseCandidateProperty.properties.commitSha.pattern],
    ["environment", releaseCandidateProperty.properties.environment.pattern],
    [
      "artifactDigest",
      releaseCandidateProperty.properties.artifactDigest.pattern,
    ],
  ] as const) {
    if (!new RegExp(pattern).test(values[key] as string))
      return { error: `release.candidate.${key} is invalid.` };
  }
  try {
    const target = new URL(values.targetUrl as string);
    if (
      !["http:", "https:"].includes(target.protocol) ||
      target.username ||
      target.password ||
      target.search ||
      target.hash
    )
      return {
        error:
          "release.candidate.targetUrl must be an HTTP(S) URL without credentials, query or fragment.",
      };
  } catch {
    return { error: "release.candidate.targetUrl must be an HTTP(S) URL." };
  }
  if (
    typeof release.policyVersion !== "string" ||
    !new RegExp(releaseProperties.policyVersion.pattern).test(
      release.policyVersion,
    )
  )
    return {
      error: "release.policyVersion must be a 64-character hexadecimal hash.",
    };
  if (
    release.maxAgeSeconds !== undefined &&
    (typeof release.maxAgeSeconds !== "number" ||
      !Number.isInteger(release.maxAgeSeconds) ||
      release.maxAgeSeconds < 1 ||
      release.maxAgeSeconds > 86400)
  )
    return {
      error: "release.maxAgeSeconds must be an integer between 1 and 86400.",
    };
  return release as ReleaseArguments;
}

export function parseGetReleaseVerdictArguments(
  args: Record<string, unknown>,
):
  | { error: string }
  | (ReleaseArguments & { workflowId: string; executionId: string }) {
  const execution = parseGetRunStatusArguments(args);
  if ("error" in execution) return execution;
  const release = parseReleaseArguments({
    candidate: args.candidate,
    policyVersion: args.policyVersion,
    ...(args.maxAgeSeconds === undefined
      ? {}
      : { maxAgeSeconds: args.maxAgeSeconds }),
  });
  if ("error" in release) return release;
  return { ...release, ...execution };
}

export function parseGetRunStatusArguments(
  args: Record<string, unknown>,
): { error: string } | { executionId: string; workflowId: string } {
  const workflow = parseWorkflowId(args);
  if ("error" in workflow) return workflow;
  const executionId = args.executionId;
  if (typeof executionId !== "string" || !executionId.trim()) {
    return { error: "executionId is required." };
  }
  return { executionId: executionId.trim(), workflowId: workflow.workflowId };
}
