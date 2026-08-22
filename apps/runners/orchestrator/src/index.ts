import { spawn } from 'child_process';
import crypto from 'crypto';
import express from 'express';
import { withRunnerProtocolSignature } from '../../shared/runner-protocol';
import { orchestratorRuntime } from './runtime';
import { createBotPullRequestWorkflowEvent } from './runtime/agent-local';
import type {
  AgentExecutionRequest,
  CiChangeContext,
  PlaywrightExecutionRequest,
  PreparedPlaywrightRunner,
} from './runtime/contracts';
import { ExecuteRequestCoordinator } from './runtime/execute-idempotency';
import { packageExecutorRuntime } from './runtime/package-executors';
import {
  GCP_ORCHESTRATOR_AUTH_MODE,
  isGcpOrchestratorRequestAuthorized,
  isLocalOrchestratorRequestAuthorized,
  LOCAL_ORCHESTRATOR_AUTH_HEADER,
} from './runtime/orchestrator-auth';
import {
  appendWorkflowDiagnosticLog,
  createWorkflowDiagnosticLogs,
  type WorkflowDiagnosticLogs,
} from './runtime/workflow-diagnostics';
import {
  createPlaywrightRuntimeNodeId,
  planPlaywrightShards,
  resolveLocalPlaywrightShardCapacity,
  resolvePlaywrightShardingMode,
  type PlaywrightExecutionObservation,
  type PlaywrightShardDiscovery,
} from './runtime/playwright-sharding';
import { createPubSubAuthorizationHeaders } from './runtime/pubsub-runner-control';
import {
  publishTerminalWorkflowEvent,
  type TerminalWorkflowEventPayload,
  WorkflowEventPublishError,
} from './runtime/terminal-workflow-events';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3012;
const EDITOR_API_URL = process.env.EDITOR_API_URL?.trim() || '';
const ATTACHMENT_NODE_TYPES = new Set(['codex-cli', 'validator']);

async function requireOrchestratorAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const authMode = process.env.PLAYRUNNER_ORCHESTRATOR_AUTH_MODE?.trim();
  const authorized =
    authMode === GCP_ORCHESTRATOR_AUTH_MODE
      ? await isGcpOrchestratorRequestAuthorized({
          authorization: req.get('authorization'),
          expectedAudience:
            process.env.PLAYRUNNER_ORCHESTRATOR_IDENTITY_AUDIENCE,
          expectedEmail:
            process.env.PLAYRUNNER_ORCHESTRATOR_CALLER_SERVICE_ACCOUNT_EMAIL,
          expectedSubject:
            process.env.PLAYRUNNER_ORCHESTRATOR_CALLER_SERVICE_ACCOUNT_SUBJECT,
        })
      : isLocalOrchestratorRequestAuthorized(
          process.env.PLAYRUNNER_ORCHESTRATOR_AUTH_TOKEN,
          req.get(LOCAL_ORCHESTRATOR_AUTH_HEADER),
        );

  if (authorized) {
    next();
    return;
  }
  res.status(401).json({ error: 'Unauthorized orchestrator request.' });
}

export function resolveEditorApiOrigin(
  _requestedValue: unknown,
  configuredValue = process.env.EDITOR_API_URL?.trim() || EDITOR_API_URL,
  required = true,
): string {
  const value = getString(configuredValue);
  if (!value) {
    if (!required) return '';
    throw new Error(
      'EDITOR_API_URL is required for runner callbacks. Set the server-owned callback origin in the orchestrator environment.',
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Runner callback origin must be a valid HTTP(S) URL.');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password
  ) {
    throw new Error(
      'Runner callback origin must be a credential-free HTTP(S) URL.',
    );
  }
  return url.origin;
}

type WorkflowEventLevel = 'info' | 'error' | 'warn' | 'build' | 'debug';
type WorkflowNodeState =
  'idle' | 'pending' | 'running' | 'success' | 'error' | 'warning';

type WorkflowEventPublisher = {
  executionId: string;
  publishEvent: (payload: Record<string, unknown>) => Promise<void>;
  publishEventStrict: (payload: Record<string, unknown>) => Promise<void>;
  publishTerminalEvent: (
    payload: TerminalWorkflowEventPayload,
  ) => Promise<void>;
  publishLog: (
    message: string,
    level?: WorkflowEventLevel,
    extra?: Record<string, unknown>,
  ) => Promise<void>;
  publishNodeState: (
    nodeId: string,
    state: WorkflowNodeState,
    extra?: Record<string, unknown>,
  ) => Promise<void>;
};

type WorkflowShardingDiagnostic = Record<string, unknown>;

type WorkflowHistoryRun = {
  diagnostics: {
    sharding: WorkflowShardingDiagnostic[];
  };
  durationMs: number | null;
  finishedAt: string;
  id: string;
  logs: WorkflowDiagnosticLogs;
  runner: string;
  startedAt: string;
  status: string;
};

type GcpPubSubEventTransport = {
  projectId?: string;
  topicName?: string;
  type?: 'gcp_pubsub';
};

type WorkflowTemplateContext = {
  definition: {
    id: string;
    name: string;
  };
  run: {
    diagnostics: {
      sharding: WorkflowShardingDiagnostic[];
    };
    durationMs: number | '';
    failedNode: {
      id: string;
      name: string;
    };
    finishedAt: string;
    id: string;
    logs: WorkflowDiagnosticLogs;
    runner: string;
    startedAt: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    trigger: string;
    url: string;
  };
  history: {
    logs: WorkflowDiagnosticLogs;
    runs: WorkflowHistoryRun[];
  };
};

const PUBSUB_API_BASE_URL = 'https://pubsub.googleapis.com/v1';
const REDACTED_VALUE = '[redacted]';
const SENSITIVE_PAYLOAD_KEY_PATTERN = /authorization|secret|token/i;

function getPubSubApiBaseUrl(): string {
  const emulatorHost = process.env.PUBSUB_EMULATOR_HOST?.trim();
  if (!emulatorHost) {
    return PUBSUB_API_BASE_URL;
  }

  const normalizedHost = emulatorHost.replace(/\/+$/, '');
  return `${normalizedHost.startsWith('http') ? normalizedHost : `http://${normalizedHost}`}/v1`;
}

function isUsingPubSubEmulator(): boolean {
  return !!process.env.PUBSUB_EMULATOR_HOST?.trim();
}

function resolvePlaywrightRuntime(
  config: Record<string, any>,
): 'typescript' | 'python' {
  const configured = config.testLanguage || config.runtime;
  if (configured === 'python') {
    return 'python';
  }
  return 'typescript';
}

type ActiveProcess = {
  executionId: string;
  nodeId: string;
  process: ReturnType<typeof spawn>;
  publisher: WorkflowEventPublisher;
  runtimeNodeId: string;
};

type ActivePreparedRunner = {
  cancel: () => Promise<void>;
  executionId: string;
  nodeId: string;
  runtimeNodeId: string;
};

type PreparedRunnerCancellationResult = {
  cancelled: number;
  failed: number;
  failureResponse: {
    error: string;
    status: 502;
  } | null;
};

const PREPARED_RUNNER_CANCELLATION_ERROR =
  'Failed to stop one or more prepared runners.';

export async function cancelPreparedRunnerMatches(
  matches: ReadonlyArray<Pick<ActivePreparedRunner, 'cancel'>>,
): Promise<PreparedRunnerCancellationResult> {
  const results = await Promise.allSettled(
    matches.map(async (active) => active.cancel()),
  );
  const cancelled = results.filter(
    (result) => result.status === 'fulfilled',
  ).length;
  const failed = results.length - cancelled;

  return {
    cancelled,
    failed,
    failureResponse:
      failed > 0
        ? {
            error: PREPARED_RUNNER_CANCELLATION_ERROR,
            status: 502,
          }
        : null,
  };
}

const activeProcesses = new Map<string, ActiveProcess>();
const activePreparedRunners = new Map<string, ActivePreparedRunner>();

function activeExecutionKey(executionId: string, nodeId: string): string {
  return JSON.stringify([executionId, nodeId]);
}

function getString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function getRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

const CI_CONTEXT_KEYS = new Set([
  'baseRef',
  'baseSha',
  'eventType',
  'headRef',
  'headSha',
  'pullRequestNumber',
  'repository',
]);
const GIT_OBJECT_ID_PATTERN = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i;

function validGitRef(value: string): boolean {
  return (
    value.length <= 255 &&
    value !== 'HEAD' &&
    !value.startsWith('refs/') &&
    !value.startsWith('/') &&
    !value.endsWith('/') &&
    !value.endsWith('.') &&
    !value.includes('..') &&
    !value.includes('@{') &&
    !Array.from(value).some(
      (character) =>
        character.charCodeAt(0) <= 32 ||
        character.charCodeAt(0) === 127 ||
        '~^:?*[\\'.includes(character),
    ) &&
    value
      .split('/')
      .every(
        (part) =>
          Boolean(part) &&
          part !== '.' &&
          part !== '..' &&
          !part.startsWith('.') &&
          !part.endsWith('.lock'),
      )
  );
}

function validRepository(value: string): boolean {
  const parts = value.split('/');
  return (
    value.length <= 200 &&
    parts.length === 2 &&
    parts.every(
      (part) =>
        /^[A-Za-z0-9_.-]+$/.test(part) &&
        part !== '.' &&
        part !== '..' &&
        !part.startsWith('-') &&
        !part.endsWith('-'),
    )
  );
}

export function resolveCiChangeContext(
  value: unknown,
  configuredRepository: unknown,
): CiChangeContext | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AI Container CI change context must be an object.');
  }
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => !CI_CONTEXT_KEYS.has(key))) {
    throw new Error('AI Container CI change context contains unknown fields.');
  }
  const repository = getString(source.repository);
  const baseSha = getString(source.baseSha);
  const headSha = getString(source.headSha);
  const baseRef = getString(source.baseRef);
  const headRef = getString(source.headRef);
  const eventType = getString(source.eventType);
  const expectedRepository = getString(configuredRepository);
  if (
    !validRepository(repository) ||
    !validRepository(expectedRepository) ||
    repository.toLowerCase() !== expectedRepository.toLowerCase() ||
    !GIT_OBJECT_ID_PATTERN.test(baseSha) ||
    !GIT_OBJECT_ID_PATTERN.test(headSha) ||
    baseSha === headSha ||
    !validGitRef(baseRef) ||
    !validGitRef(headRef) ||
    !['manual', 'pull_request', 'push'].includes(eventType)
  ) {
    throw new Error(
      'AI Container CI change context does not match the configured repository or contains an invalid commit/ref.',
    );
  }
  const pullRequestNumber = Number(source.pullRequestNumber);
  if (
    source.pullRequestNumber !== undefined &&
    (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1)
  ) {
    throw new Error('AI Container CI pull request number is invalid.');
  }
  return {
    baseRef,
    baseSha: baseSha.toLowerCase(),
    eventType: eventType as CiChangeContext['eventType'],
    headRef,
    headSha: headSha.toLowerCase(),
    ...(source.pullRequestNumber === undefined ? {} : { pullRequestNumber }),
    repository,
  };
}

function structuredValueDepth(value: unknown, depth = 0): number {
  if (!value || typeof value !== 'object') return depth;
  if (depth >= 9) return depth;
  const children = Array.isArray(value)
    ? value
    : Object.values(value as Record<string, unknown>);
  return children.reduce(
    (maximum, child) =>
      Math.max(maximum, structuredValueDepth(child, depth + 1)),
    depth,
  );
}

export function resolveAgentMemory(
  value: unknown,
): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AI Container memory must be a structured object.');
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error('AI Container memory must be JSON serializable.');
  }
  if (
    Buffer.byteLength(serialized, 'utf8') > 64 * 1024 ||
    structuredValueDepth(value) > 8
  ) {
    throw new Error('AI Container memory exceeds its size or depth limit.');
  }
  return JSON.parse(serialized) as Record<string, unknown>;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'Unknown error';
}

function getPathValue(source: Record<string, any>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') {
      return undefined;
    }

    return (current as Record<string, unknown>)[segment];
  }, source);
}

function formatTemplateValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return JSON.stringify(value);
}

function getDurationMs(startedAt: string, finishedAt: Date): number {
  const startedAtMs = new Date(startedAt).getTime();
  if (Number.isNaN(startedAtMs)) {
    return 0;
  }

  return Math.max(0, finishedAt.getTime() - startedAtMs);
}

async function loadWorkflowDiagnosticHistory(
  reqBody: Record<string, any>,
): Promise<Record<string, unknown>> {
  const editorApiUrl = resolveEditorApiOrigin(
    reqBody.editorApiUrl,
    undefined,
    false,
  );
  const executionId = getString(reqBody.testId);
  const executionToken = getString(reqBody.executionAuthToken);
  if (!editorApiUrl || !executionId || !executionToken) {
    return { runs: [] };
  }

  try {
    const response = await fetch(
      `${editorApiUrl.replace(/\/+$/, '')}/api/outputs/${encodeURIComponent(executionId)}/diagnostics/history`,
      {
        headers: { 'x-execution-token': executionToken },
      },
    );
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const history: unknown = await response.json();
    return getRecord(history);
  } catch (error) {
    console.warn(
      `Workflow diagnostic history is unavailable for ${executionId}: ${getErrorMessage(error)}`,
    );
    return { runs: [] };
  }
}

function createWorkflowTemplateContext(
  reqBody: Record<string, any>,
  testId: string,
  startedAt: Date,
  history: Record<string, unknown>,
): WorkflowTemplateContext {
  const workflow = getRecord(reqBody.workflow);
  const definition = getRecord(workflow.definition);
  const run = getRecord(workflow.run);
  const failedNode = getRecord(run.failedNode);
  const historyRuns = Array.isArray(history.runs) ? history.runs : [];
  const historyLogs = Array.isArray(history.logs)
    ? history.logs
    : historyRuns.flatMap((historyRun) => {
        const logs = getRecord(historyRun).logs;
        return Array.isArray(logs) ? logs : [];
      });
  const workflowId = getString(definition.id) || getString(reqBody.workflowId);

  return {
    definition: {
      id: workflowId,
      name:
        getString(definition.name) ||
        getString(reqBody.workflowName) ||
        getString(reqBody.title) ||
        'Untitled Workflow',
    },
    run: {
      diagnostics: {
        sharding: [],
      },
      durationMs: '',
      failedNode: {
        id: getString(failedNode.id),
        name: getString(failedNode.name),
      },
      finishedAt: '',
      id: testId,
      logs: createWorkflowDiagnosticLogs(),
      runner:
        getString(run.runner) ||
        getString(reqBody.cloudProvider) ||
        'LOCAL_RUNNER',
      startedAt: startedAt.toISOString(),
      status: 'running',
      trigger:
        getString(run.trigger) || (reqBody.scheduler ? 'schedule' : 'manual'),
      url: getString(run.url),
    },
    history: {
      logs: normalizeDiagnosticLogs(historyLogs),
      runs: historyRuns.length
        ? (historyRuns as WorkflowHistoryRun[]).map((historyRun) => ({
            ...historyRun,
            logs: normalizeDiagnosticLogs(historyRun.logs),
          }))
        : [],
    },
  };
}

function normalizeDiagnosticLogs(value: unknown): WorkflowDiagnosticLogs {
  const normalized = createWorkflowDiagnosticLogs();

  if (Array.isArray(value)) {
    for (const entry of value) {
      const log = getRecord(entry);
      const level = getString(log.level) as WorkflowEventLevel;
      if (
        !['build', 'debug', 'error', 'info', 'warn'].includes(level) ||
        !getString(log.message) ||
        !getString(log.timestamp)
      ) {
        continue;
      }
      appendWorkflowDiagnosticLog(normalized, {
        level,
        message: getString(log.message),
        ...(getString(log.nodeId) ? { nodeId: getString(log.nodeId) } : {}),
        timestamp: getString(log.timestamp),
      });
    }
    return normalized;
  }

  const logs = getRecord(value);

  for (const level of ['all', 'build', 'debug', 'error', 'info', 'warn']) {
    if (Array.isArray(logs[level])) {
      normalized[level as keyof WorkflowDiagnosticLogs] = logs[
        level
      ] as WorkflowDiagnosticLogs[keyof WorkflowDiagnosticLogs];
    }
  }

  return normalized;
}

function playwrightHistoryForNode(
  runs: WorkflowHistoryRun[],
  nodeId: string,
): PlaywrightExecutionObservation[] {
  return runs
    .flatMap((run) => run.diagnostics.sharding)
    .filter(
      (diagnostic): diagnostic is PlaywrightExecutionObservation =>
        getString(diagnostic.type) === 'playwright_execution_observation' &&
        getString(diagnostic.nodeId) === nodeId,
    )
    .slice(0, 10);
}

function finishWorkflowRun(
  workflow: WorkflowTemplateContext,
  status: WorkflowTemplateContext['run']['status'],
) {
  const finishedAt = new Date();
  workflow.run.status = status;
  workflow.run.finishedAt = finishedAt.toISOString();
  workflow.run.durationMs = getDurationMs(workflow.run.startedAt, finishedAt);
}

function markWorkflowRunFailed(
  workflow: WorkflowTemplateContext,
  node?: { id?: string; label?: string },
) {
  if (!workflow.run.failedNode.id && node?.id) {
    workflow.run.failedNode.id = node.id;
    workflow.run.failedNode.name = getString(node.label) || node.id;
  }

  finishWorkflowRun(workflow, 'failed');
}

function prepareWorkflowRunStatusForNode({
  activeNodeCount,
  outgoingCount,
  workflow,
}: {
  activeNodeCount: number;
  outgoingCount: number;
  workflow: WorkflowTemplateContext;
}) {
  if (workflow.run.status === 'failed') {
    return;
  }

  if (activeNodeCount === 1 && outgoingCount === 0) {
    finishWorkflowRun(workflow, 'completed');
    return;
  }

  workflow.run.status = 'running';
  workflow.run.finishedAt = '';
  workflow.run.durationMs = '';
}

function renderNodeTemplate(
  text: string,
  context: {
    env: Record<string, string>;
    nodeLogs: ReadonlyMap<string, WorkflowDiagnosticLogs>;
    nodeOutputs: Record<string, unknown>;
    workflow: WorkflowTemplateContext;
  },
) {
  if (!text) {
    return text;
  }

  return text.replace(/{{\s*([^{}]+?)\s*}}/g, (match, expression) => {
    const path = expression.trim();
    if (path.startsWith('node_')) {
      const logMatch = path.match(
        /^node_(.+)\.logs(?:\.(all|build|debug|error|info|warn))?$/,
      );
      if (logMatch) {
        const logs = context.nodeLogs.get(logMatch[1]);
        return formatTemplateValue(
          logMatch[2]
            ? logs?.[logMatch[2] as keyof WorkflowDiagnosticLogs]
            : logs,
        );
      }
      return formatTemplateValue(getPathValue(context.nodeOutputs, path));
    }
    if (!path.startsWith('env.') && !path.startsWith('workflow.')) {
      return match;
    }

    return formatTemplateValue(getPathValue(context, path));
  });
}

function renderNodeTemplateValue(
  value: unknown,
  context: Parameters<typeof renderNodeTemplate>[1],
): unknown {
  if (typeof value === 'string') {
    return renderNodeTemplate(value, context);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => renderNodeTemplateValue(entry, context));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        renderNodeTemplateValue(entry, context),
      ]),
    );
  }
  return value;
}

function isSensitivePayloadKey(key: string): boolean {
  return (
    key.toLowerCase() === 'code' || SENSITIVE_PAYLOAD_KEY_PATTERN.test(key)
  );
}

export function redactSensitivePayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitivePayload(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      key.toLowerCase() === 'environment' &&
      entry &&
      typeof entry === 'object' &&
      !Array.isArray(entry)
        ? Object.fromEntries(
            Object.keys(entry as Record<string, unknown>).map(
              (environmentKey) => [environmentKey, REDACTED_VALUE],
            ),
          )
        : isSensitivePayloadKey(key)
          ? REDACTED_VALUE
          : redactSensitivePayload(entry),
    ]),
  );
}

function writeWorkflowLogToConsole(
  executionId: string,
  message: string,
  level: WorkflowEventLevel,
) {
  const renderedMessage = `[Workflow ${executionId || 'unknown'}] ${message}`;

  if (level === 'error') {
    console.error(renderedMessage);
    return;
  }

  if (level === 'warn') {
    console.warn(renderedMessage);
    return;
  }

  console.log(renderedMessage);
}

async function publishGcpPubSubEvent(args: {
  accessToken?: string;
  eventAuthToken?: string;
  executionId: string;
  executionToken?: string;
  payload: Record<string, unknown>;
  projectId: string;
  topicName: string;
}) {
  if (!args.accessToken && !isUsingPubSubEmulator()) {
    throw new Error('Pub/Sub access token is required.');
  }

  const eventId = getString(args.payload.eventId) || crypto.randomUUID();
  const unsignedPayload: Record<string, unknown> = {
    executionId: args.executionId,
    testId: args.executionId,
    ...args.payload,
    eventId,
  };
  const payload: Record<string, unknown> = args.eventAuthToken
    ? withRunnerProtocolSignature(unsignedPayload, args.eventAuthToken)
    : {
        ...unsignedPayload,
        executionAuthToken: args.executionToken,
      };
  const eventType = getString(payload.type) || 'event';
  const apiBaseUrl = getPubSubApiBaseUrl();
  let response: Response;
  try {
    response = await fetch(
      `${apiBaseUrl}/projects/${args.projectId}/topics/${args.topicName}:publish`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...createPubSubAuthorizationHeaders(apiBaseUrl, args.accessToken),
        },
        body: JSON.stringify({
          messages: [
            {
              attributes: {
                cloudProvider: getString(payload.cloudProvider) || 'GCP',
                eventId,
                eventType,
                executionId: args.executionId,
                messageKind: 'workflow_event',
              },
              data: Buffer.from(JSON.stringify(payload), 'utf8').toString(
                'base64',
              ),
              orderingKey: args.executionId,
            },
          ],
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch (error) {
    throw new WorkflowEventPublishError(
      'Pub/Sub publish failed before receiving a response.',
      { cause: error, retryable: true },
    );
  }

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new WorkflowEventPublishError(
      `Pub/Sub publish failed (${response.status}): ${details.slice(0, 500)}`,
      {
        retryable:
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500,
      },
    );
  }
}

function createWorkflowEventPublisher(
  reqBody: Record<string, any>,
  onLog?: (entry: {
    level: WorkflowEventLevel;
    message: string;
    nodeId?: string;
    parentNodeId?: string;
    timestamp: string;
  }) => void,
): WorkflowEventPublisher {
  const executionId = typeof reqBody.testId === 'string' ? reqBody.testId : '';
  const executionToken =
    typeof reqBody.executionAuthToken === 'string'
      ? reqBody.executionAuthToken
      : '';
  const eventAuthToken = getString(reqBody.eventAuthToken);
  const eventTransport = reqBody.eventTransport as
    GcpPubSubEventTransport | undefined;
  const gcpAccessToken = getString(reqBody.settings?.gcp?.accessToken);
  const basePayload = {
    cloudProvider: reqBody.cloudProvider || 'LOCAL_RUNNER',
    workflowId: reqBody.workflowId || null,
  };

  const publishEventStrict = async (payload: Record<string, unknown>) => {
    if (!executionId || (!executionToken && !eventAuthToken)) {
      throw new Error(
        'Workflow event publish requires an execution authentication context.',
      );
    }

    const mergedPayload = {
      ...basePayload,
      ...payload,
      eventId: getString(payload.eventId) || crypto.randomUUID(),
    };

    if (
      eventTransport?.type !== 'gcp_pubsub' ||
      !eventTransport.projectId ||
      !eventTransport.topicName
    ) {
      throw new Error('Pub/Sub event transport is required.');
    }

    await publishGcpPubSubEvent({
      accessToken: gcpAccessToken,
      eventAuthToken,
      executionId,
      executionToken,
      payload: mergedPayload,
      projectId: eventTransport.projectId,
      topicName: eventTransport.topicName,
    });
  };

  const publishEvent = async (payload: Record<string, unknown>) => {
    try {
      await publishEventStrict(payload);
    } catch (error) {
      console.error(
        `Failed to publish workflow event for ${executionId}:`,
        error,
      );
    }
  };

  return {
    executionId,
    publishEvent,
    publishEventStrict,
    publishTerminalEvent: async (payload) =>
      publishTerminalWorkflowEvent(payload, publishEventStrict),
    publishLog: async (message, level = 'info', extra = {}) => {
      writeWorkflowLogToConsole(executionId, message, level);
      const timestamp = new Date().toISOString();
      const nodeId = getString(extra.nodeId);
      const parentNodeId = getString(extra.parentNodeId);
      onLog?.({
        level,
        message,
        ...(nodeId ? { nodeId } : {}),
        ...(parentNodeId ? { parentNodeId } : {}),
        timestamp,
      });
      await publishEvent({
        ...extra,
        level,
        message,
        timestamp,
        type: 'log',
      });
    },
    publishNodeState: async (nodeId, state, extra = {}) => {
      await publishEvent({
        ...extra,
        nodeId,
        state,
        timestamp: new Date().toISOString(),
        type: 'node_state',
      });
    },
  };
}

export async function executeWorkflow(reqBody: any) {
  const workflowHistory = await loadWorkflowDiagnosticHistory(reqBody);
  const workflowContext = createWorkflowTemplateContext(
    reqBody,
    getString(reqBody.testId),
    new Date(),
    workflowHistory,
  );
  const nodeDiagnosticLogs = new Map<string, WorkflowDiagnosticLogs>();
  const getNodeDiagnosticLogs = (nodeId: string) => {
    const existing = nodeDiagnosticLogs.get(nodeId);
    if (existing) return existing;

    const logs = createWorkflowDiagnosticLogs({
      maxBytes: 64 * 1024,
      maxEntries: 100,
    });
    nodeDiagnosticLogs.set(nodeId, logs);
    return logs;
  };
  const captureDiagnosticLog = (
    entry: Parameters<typeof appendWorkflowDiagnosticLog>[1] & {
      parentNodeId?: string;
    },
  ) => {
    appendWorkflowDiagnosticLog(workflowContext.run.logs, entry);
    const nodeIds = new Set(
      [entry.nodeId, entry.parentNodeId].filter(Boolean) as string[],
    );
    for (const nodeId of nodeIds) {
      appendWorkflowDiagnosticLog(getNodeDiagnosticLogs(nodeId), entry);
    }
  };
  const eventPublisher = createWorkflowEventPublisher(reqBody, (entry) => {
    captureDiagnosticLog(entry);
  });
  const {
    publishEvent,
    publishEventStrict,
    publishLog,
    publishNodeState,
    publishTerminalEvent,
  } = eventPublisher;
  let terminalEventAttempted = false;
  let workflowFailed = false;
  const preparedPlaywrightRunners: Record<
    string,
    Promise<PreparedPlaywrightRunner>
  > = {};

  try {
    const { nodes, connections, settings, testId, bucketName } = reqBody;
    const nodeCount = Array.isArray(nodes) ? nodes.length : 0;

    console.log(
      'Runner received workflow execution request with nodes:',
      nodeCount,
    );

    await publishEvent({
      level: 'info',
      message: `Cloud orchestrator received workflow execution request with ${nodeCount} node${nodeCount === 1 ? '' : 's'}.`,
      timestamp: new Date().toISOString(),
      type: 'workflow_started',
      workflow: workflowContext,
    });

    if (nodes && Array.isArray(nodes)) {
      const attachmentConnections = (connections || []).filter(
        (connection: any) => connection.role === 'attachment',
      );
      const attachmentNodeIds = new Set(
        attachmentConnections.map((connection: any) => connection.sourceId),
      );
      const workflowNodes = nodes.filter(
        (node: any) =>
          !attachmentNodeIds.has(node.id) &&
          !ATTACHMENT_NODE_TYPES.has(packageExecutorRuntime.nodeType(node)),
      );
      packageExecutorRuntime.preflight(workflowNodes);

      const globalEnvVars: Record<string, string> = {};
      const nodeTemplateOutputs: Record<string, unknown> = Object.fromEntries(
        nodes
          .filter(
            (node: Record<string, unknown>) =>
              getString(node.id) && node.output !== undefined,
          )
          .map((node: Record<string, unknown>) => [
            `node_${getString(node.id)}`,
            node.output,
          ]),
      );
      const envNodes = nodes.filter(
        (n) => packageExecutorRuntime.nodeType(n) === 'environment',
      );
      for (const envNode of envNodes) {
        if (envNode.config?.variables) {
          envNode.config.variables.forEach((v: any) => {
            if (v.enabled && v.key) {
              globalEnvVars[v.key] = v.currentValue || v.initialValue || '';
            }
          });
        }
      }

      const processedConnections = (connections || []).filter(
        (connection: any) => connection.role !== 'attachment',
      );

      for (const node of workflowNodes) {
        const implicitParents = [
          ...(Array.isArray(node.parentNodes) ? node.parentNodes : []),
          ...(node.parentId ? [node.parentId] : []),
        ];

        for (const parentId of implicitParents) {
          const hasExplicit = processedConnections.some(
            (c) => c.sourceId === parentId && c.targetId === node.id,
          );
          if (!hasExplicit) {
            processedConnections.push({
              sourceId: parentId,
              targetId: node.id,
              type: 'sequential',
            });
          }
        }
      }

      if (processedConnections.length > 0) {
        await publishLog(
          `Analyzing ${processedConnections.length} workflow connections...`,
          'info',
        );
        for (const conn of processedConnections) {
          const type = conn.type || 'sequential';
          await publishLog(
            `Connection ${conn.sourceId} -> ${conn.targetId} is marked as [${type.toUpperCase()}]`,
            'debug',
          );
        }
      }

      const registerActiveProcessForNode = (
        runtimeNodeId: string,
        process: ReturnType<typeof spawn>,
        logicalNodeId = runtimeNodeId,
      ) => {
        const key = activeExecutionKey(testId, runtimeNodeId);
        const activeProcess: ActiveProcess = {
          executionId: testId,
          nodeId: logicalNodeId,
          process,
          publisher: eventPublisher,
          runtimeNodeId,
        };
        activeProcesses.set(key, activeProcess);

        const removeActiveProcess = () => {
          if (activeProcesses.get(key) === activeProcess) {
            activeProcesses.delete(key);
          }
        };
        process.on('exit', removeActiveProcess);
        process.on('error', removeActiveProcess);
      };

      const createPlaywrightExecutionRequest = (
        node: any,
        overrides: {
          blobArtifacts?: unknown[];
          cpu?: number;
          executionMode?: 'aggregate' | 'discovery' | 'shard' | 'test';
          memory?: number;
          outputNodeId?: string;
          runtimeNodeId?: string;
          shardIndex?: number;
          shardTotal?: number;
          sourceRevision?: string;
          workers?: number;
        } = {},
      ): {
        cpu: number;
        envKeys: string[];
        injectedEnv: string;
        memory: number;
        request: PlaywrightExecutionRequest;
        workers: number;
      } => {
        const config = node.config || {};
        const runtime = resolvePlaywrightRuntime(config);
        const cpu = overrides.cpu || config.cpu || 2;
        const memory = overrides.memory || config.memory || 4;
        const workers = overrides.workers || config.workers || 1;
        const envKeys = config.envVars || [];
        const cloudProvider = reqBody.cloudProvider || 'LOCAL_RUNNER';
        const runtimeNodeId = overrides.runtimeNodeId || node.id;
        const payloadData = {
          data: {
            repository: config.repository,
            branch: config.branch,
            folder: config.folder,
            action: config.action,
            executionAuthToken: reqBody.executionAuthToken,
            testScript: config.testScript,
            nodeId: runtimeNodeId,
            logicalNodeId: node.id,
            executionMode: overrides.executionMode || 'test',
            ...(overrides.outputNodeId
              ? { outputNodeId: overrides.outputNodeId }
              : {}),
            ...(overrides.shardIndex
              ? { shardIndex: overrides.shardIndex }
              : {}),
            ...(overrides.shardTotal
              ? { shardTotal: overrides.shardTotal }
              : {}),
            ...(overrides.sourceRevision
              ? { sourceRevision: overrides.sourceRevision }
              : {}),
            ...(overrides.blobArtifacts
              ? { blobArtifacts: overrides.blobArtifacts }
              : {}),
            testId,
            testLanguage: runtime,
            playwrightVersion: config.playwrightVersion || 'latest',
            workers,
            editorApiUrl: resolveEditorApiOrigin(reqBody.editorApiUrl),
            eventTransport: reqBody.eventTransport,
            bucketName: reqBody.bucketName || bucketName || null,
            cloudProvider,
          },
          github: settings?.github,
          settings: settings?.gcp ? { gcp: settings.gcp } : {},
        };

        return {
          cpu,
          envKeys,
          injectedEnv: envKeys.map((key: string) => `${key}=***`).join(', '),
          memory,
          request: {
            config: { ...config, cpu, memory, workers },
            envKeys,
            globalEnvVars,
            nodeId: runtimeNodeId,
            payloadData,
            publishEvent: publishEventStrict,
            publishLog: (message, level) =>
              publishLog(message, level, {
                nodeId: runtimeNodeId,
                ...(runtimeNodeId === node.id ? {} : { parentNodeId: node.id }),
              }),
            registerActiveProcess: (activeNodeId, process) => {
              registerActiveProcessForNode(
                activeNodeId,
                process as ReturnType<typeof spawn>,
                node.id,
              );
            },
            reqBody,
            runtime,
          },
          workers,
        };
      };

      const createAgentExecutionRequest = (
        node: any,
      ): AgentExecutionRequest => {
        const incomingSourceIds = new Set(
          processedConnections
            .filter((connection: any) => connection.targetId === node.id)
            .map((connection: any) => getString(connection.sourceId))
            .filter(Boolean),
        );
        const directNodeOutputs = Object.fromEntries(
          [...incomingSourceIds]
            .map((sourceId) => `node_${sourceId}`)
            .filter((key) => Object.hasOwn(nodeTemplateOutputs, key))
            .map((key) => [key, nodeTemplateOutputs[key]]),
        );
        const templateContext = {
          env: globalEnvVars,
          nodeLogs: nodeDiagnosticLogs,
          nodeOutputs: directNodeOutputs,
          workflow: workflowContext,
        };
        const attachedNodes = attachmentConnections
          .filter((connection: any) => connection.targetId === node.id)
          .map((connection: any) => ({
            connection,
            node: nodes.find(
              (candidate: any) => candidate.id === connection.sourceId,
            ),
          }))
          .filter((entry: any) => entry.node);
        const agents = attachedNodes.filter(
          (entry: any) => entry.connection.attachmentPort === 'agent',
        );
        const validators = attachedNodes.filter(
          (entry: any) => entry.connection.attachmentPort === 'tool',
        );
        if (agents.length !== 1) {
          throw new Error(
            `AI Container ${node.label || node.id} requires exactly one Agent attachment; found ${agents.length}.`,
          );
        }
        if (validators.length < 1) {
          throw new Error(
            `AI Container ${node.label || node.id} requires at least one Validator attachment.`,
          );
        }
        const config = renderNodeTemplateValue(
          node.config || {},
          templateContext,
        ) as Record<string, unknown>;
        const agentNodeType = packageExecutorRuntime.nodeType(agents[0].node);
        if (agentNodeType !== 'codex-cli') {
          throw new Error(`Unsupported AI Container Agent: ${agentNodeType}.`);
        }
        const agentConfig = renderNodeTemplateValue(
          agents[0].node.config || {},
          templateContext,
        ) as Record<string, unknown>;
        const apiKeyEnvVar = String(agentConfig.apiKeyEnvVar || '').trim();
        if (!apiKeyEnvVar) {
          throw new Error(
            'Codex CLI requires an API key Environment variable. Open the Codex CLI configuration and select one from the Input panel.',
          );
        }
        if (!globalEnvVars[apiKeyEnvVar]) {
          throw new Error(
            `Codex CLI API key Environment variable ${apiKeyEnvVar} is missing or empty.`,
          );
        }
        const envKeys = Array.from(
          new Set([
            ...(Array.isArray(config.envVars) ? config.envVars : []),
            apiKeyEnvVar,
          ]),
        );
        const resolvedValidators = validators.map((entry: any) => ({
          config: renderNodeTemplateValue(
            entry.node.config || {},
            templateContext,
          ) as Record<string, unknown>,
          nodeId: getString(entry.node.id),
          nodeType: packageExecutorRuntime.nodeType(entry.node),
        }));
        const unsupportedValidator = resolvedValidators.find(
          (validator: any) => validator.nodeType !== 'validator',
        );
        if (unsupportedValidator) {
          throw new Error(
            `Unsupported AI Container Validator: ${unsupportedValidator.nodeType}.`,
          );
        }
        const runtimeTestId = getString(testId);
        const runtimeEditorApiUrl = resolveEditorApiOrigin(
          reqBody.editorApiUrl,
        );
        const runtimeExecutionAuthToken = getString(reqBody.executionAuthToken);
        const runtimeWorkflowId = getString(reqBody.workflowId);
        if (!runtimeTestId) {
          throw new Error('AI Container execution requires a testId.');
        }
        if (!runtimeExecutionAuthToken) {
          throw new Error(
            'AI Container execution requires an executionAuthToken for artifact publication.',
          );
        }
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(runtimeWorkflowId)) {
          throw new Error(
            'AI Container execution requires a safe trusted workflowId.',
          );
        }
        const changeContext = resolveCiChangeContext(
          reqBody.ci,
          config.repository,
        );
        const memoryByNodeId = reqBody.agentMemoryByNodeId;
        if (
          memoryByNodeId !== undefined &&
          (!memoryByNodeId ||
            typeof memoryByNodeId !== 'object' ||
            Array.isArray(memoryByNodeId))
        ) {
          throw new Error('AI Container memory map must be an object.');
        }
        const memory = resolveAgentMemory(
          (memoryByNodeId as Record<string, unknown> | undefined)?.[node.id],
        );
        return {
          agent: {
            config: agentConfig,
            nodeId: getString(agents[0].node.id),
            nodeType: agentNodeType,
          },
          config,
          ...(changeContext ? { changeContext } : {}),
          envKeys,
          globalEnvVars,
          nodeId: node.id,
          nodeOutputs: structuredClone(directNodeOutputs),
          ...(memory ? { memory } : {}),
          publishEvent: publishEventStrict,
          publishLog: (message, level) =>
            publishLog(message, level, { nodeId: node.id }),
          registerActiveProcess: (activeNodeId, process) =>
            registerActiveProcessForNode(
              activeNodeId,
              process as ReturnType<typeof spawn>,
              node.id,
            ),
          reqBody,
          runtime: {
            ...(getString(bucketName || reqBody.bucketName)
              ? { bucketName: getString(bucketName || reqBody.bucketName) }
              : {}),
            cloudProvider: getString(reqBody.cloudProvider) || 'LOCAL_RUNNER',
            editorApiUrl: runtimeEditorApiUrl,
            executionAuthToken: runtimeExecutionAuthToken,
            nodeId: node.id,
            testId: runtimeTestId,
            workflowId: runtimeWorkflowId,
          },
          validators: resolvedValidators,
        };
      };

      const playwrightNodes = workflowNodes.filter(
        (node: any) => packageExecutorRuntime.nodeType(node) === 'playwright',
      );
      const prewarmPlaywrightNodes = playwrightNodes.filter(
        (node: any) =>
          resolvePlaywrightShardingMode(getRecord(node.config)) === 'off',
      );

      if (prewarmPlaywrightNodes.length > 0) {
        void publishLog(
          `Preparing ${prewarmPlaywrightNodes.length} Playwright runner${prewarmPlaywrightNodes.length === 1 ? '' : 's'} before workflow execution reaches them...`,
          'info',
        );

        for (const node of prewarmPlaywrightNodes) {
          const { request } = createPlaywrightExecutionRequest(node);
          void publishNodeState(node.id, 'pending');
          void publishLog(
            `Starting Playwright Runner preparation for ${node.label || node.id} (${node.id}).`,
            'info',
          );
          const prewarmActiveKey = activeExecutionKey(testId, node.id);
          const preparedPromise = orchestratorRuntime.playwrightExecution
            .prepare(request)
            .then((runner) => {
              activePreparedRunners.set(prewarmActiveKey, {
                cancel: async () => {
                  await (
                    runner.cancel ||
                    runner.cleanup ||
                    (async () => undefined)
                  )();
                },
                executionId: testId,
                nodeId: node.id,
                runtimeNodeId: node.id,
              });
              return runner;
            })
            .catch(async (error) => {
              await publishLog(
                `Failed to prepare Playwright Runner for ${node.id}: ${error.message}`,
                'error',
              );
              throw error;
            });
          void preparedPromise.catch(() => undefined);
          preparedPlaywrightRunners[node.id] = preparedPromise;
        }
      }

      const runPreparedPlaywrightRequest = async (
        request: PlaywrightExecutionRequest,
        preparedRunner?: PreparedPlaywrightRunner,
      ) => {
        const runner =
          preparedRunner ||
          (await orchestratorRuntime.playwrightExecution.prepare(request));
        const runtimeNodeId =
          getString(request.payloadData?.data?.nodeId) || request.nodeId;
        const logicalNodeId =
          getString(request.payloadData?.data?.logicalNodeId) || request.nodeId;
        const activeKey = activeExecutionKey(testId, runtimeNodeId);
        let cancellationRequested = false;
        activePreparedRunners.set(activeKey, {
          cancel: async () => {
            cancellationRequested = true;
            await (
              runner.cancel ||
              runner.cleanup ||
              (async () => undefined)
            )();
          },
          executionId: testId,
          nodeId: logicalNodeId,
          runtimeNodeId,
        });
        try {
          await runner.waitUntilReady();
          if (cancellationRequested) {
            throw new Error('Playwright runner was cancelled.');
          }
          await request.publishLog(
            `Prepared Playwright Runner for ${logicalNodeId} is ready. Sending start signal.`,
            'info',
          );
          await runner.start();
          await request.publishLog(
            `Playwright Runner for ${logicalNodeId} acknowledged start signal.`,
            'info',
          );
          const result = await runner.waitForCompletion();
          for (const entry of result.diagnosticLogs || []) {
            captureDiagnosticLog({
              ...entry,
              ...(logicalNodeId === entry.nodeId
                ? {}
                : { parentNodeId: logicalNodeId }),
            });
          }
          return result;
        } finally {
          activePreparedRunners.delete(activeKey);
          await runner.cleanup?.();
        }
      };

      const executeShardedPlaywrightNode = async (node: any) => {
        const config = getRecord(node.config);
        if (resolvePlaywrightRuntime(config) !== 'typescript') {
          throw new Error(
            'Playwright sharding is currently supported only for TypeScript.',
          );
        }

        const discoveryNodeId = createPlaywrightRuntimeNodeId(
          node.id,
          'discovery',
        );
        await publishNodeState(discoveryNodeId, 'pending', {
          childKind: 'discovery',
          parentNodeId: node.id,
        });
        const discoveryRequest = createPlaywrightExecutionRequest(node, {
          executionMode: 'discovery',
          runtimeNodeId: discoveryNodeId,
        }).request;
        const discoveryResult =
          await runPreparedPlaywrightRequest(discoveryRequest);
        if (discoveryResult.outcome === 'error') {
          throw new Error('Playwright suite discovery failed.');
        }
        const discovery = getRecord(
          discoveryResult.output.discovery,
        ) as PlaywrightShardDiscovery;
        if (!Number.isFinite(discovery.testCount)) {
          throw new Error('Playwright suite discovery returned no test plan.');
        }

        const plan = planPlaywrightShards({
          capacity:
            reqBody.cloudProvider === 'LOCAL_RUNNER'
              ? {
                  ...resolveLocalPlaywrightShardCapacity(),
                  ...getRecord(reqBody.shardCapacity),
                }
              : getRecord(reqBody.shardCapacity),
          config,
          discovery,
          history: playwrightHistoryForNode(
            workflowContext.history.runs,
            node.id,
          ),
        });
        const shardChildren = Array.from(
          { length: plan.count },
          (_, offset) => {
            const shardIndex = offset + 1;
            return {
              childKind: 'shard',
              nodeId: createPlaywrightRuntimeNodeId(
                node.id,
                'shard',
                shardIndex,
                plan.count,
              ),
              shardIndex,
              shardTotal: plan.count,
            };
          },
        );
        const aggregateNodeId = createPlaywrightRuntimeNodeId(
          node.id,
          'aggregate',
        );
        const planTimestamp = new Date().toISOString();
        workflowContext.run.diagnostics.sharding.push({
          discovery,
          nodeId: node.id,
          nodeName: getString(node.label) || node.id,
          plan,
          timestamp: planTimestamp,
          type: 'shard_plan',
        });
        await publishEvent({
          aggregateNodeId,
          children: shardChildren,
          discovery,
          nodeId: node.id,
          plan,
          timestamp: planTimestamp,
          type: 'shard_plan',
        });
        await publishLog(
          `Shard plan for ${node.label || node.id}: ${plan.count} runners (${plan.reason}); aggregate CPU ${plan.aggregateCpu}, memory ${plan.aggregateMemoryGb}GB, workers ${plan.aggregateWorkers}.`,
          'info',
          { nodeId: node.id, plan, type: 'shard_plan_log' },
        );

        const shardSettled = await Promise.allSettled(
          shardChildren.map(async (child) => {
            await publishNodeState(child.nodeId, 'pending', {
              ...child,
              parentNodeId: node.id,
            });
            const request = createPlaywrightExecutionRequest(node, {
              cpu: plan.cpuPerShard,
              executionMode: 'shard',
              memory: plan.memoryGbPerShard,
              runtimeNodeId: child.nodeId,
              shardIndex: child.shardIndex,
              shardTotal: child.shardTotal,
              sourceRevision: discovery.sourceRevision,
              workers: plan.workersPerShard,
            }).request;
            const startedAt = Date.now();
            const result = await runPreparedPlaywrightRequest(request);
            return { ...result, durationMs: Date.now() - startedAt };
          }),
        );
        const shardResults = shardSettled.map((settled, index) => {
          if (settled.status === 'rejected') {
            return {
              child: shardChildren[index],
              error: getErrorMessage(settled.reason),
              outcome: 'error' as const,
              output: {},
            };
          }
          return { child: shardChildren[index], ...settled.value };
        });
        const blobReportsComplete = shardResults.every((result) => {
          const artifact = getRecord(getRecord(result.output).blobArtifact);
          return Boolean(artifact.fileName && artifact.checksum);
        });
        const observationTimestamp = new Date().toISOString();
        const observation = {
          blobReportsComplete,
          completed:
            shardSettled.every((settled) => settled.status === 'fulfilled') &&
            blobReportsComplete,
          cpuPerShard: plan.cpuPerShard,
          discovery,
          durationMs: Math.max(
            0,
            ...shardResults.map((result) =>
              'durationMs' in result ? result.durationMs : 0,
            ),
          ),
          memoryGbPerShard: plan.memoryGbPerShard,
          nodeId: node.id,
          shardCount: plan.count,
          shardDurationsMs: shardResults.map((result) =>
            'durationMs' in result ? result.durationMs : 0,
          ),
          timestamp: observationTimestamp,
          type: 'playwright_execution_observation',
          workersPerShard: plan.workersPerShard,
        };
        workflowContext.run.diagnostics.sharding.push(observation);
        await publishEvent(observation);
        await Promise.all(
          shardResults
            .filter((result) => 'error' in result)
            .map((result) =>
              publishNodeState(result.child.nodeId, 'error', {
                ...result.child,
                parentNodeId: node.id,
              }),
            ),
        );
        let blobArtifacts: Record<string, any>[];
        try {
          blobArtifacts = shardResults.map((result) => {
            const artifact = getRecord(getRecord(result.output).blobArtifact);
            if (!artifact.fileName || !artifact.checksum) {
              throw new Error(
                `Shard ${result.child.shardIndex}/${plan.count} did not produce a valid blob report.`,
              );
            }
            return artifact;
          });
        } catch (error) {
          await publishNodeState(aggregateNodeId, 'error', {
            childKind: 'aggregate',
            parentNodeId: node.id,
          });
          await publishLog(
            `Merge reports could not start: ${getErrorMessage(error)}`,
            'error',
            {
              childKind: 'aggregate',
              nodeId: aggregateNodeId,
              parentNodeId: node.id,
            },
          );
          throw error;
        }

        await publishNodeState(aggregateNodeId, 'pending', {
          childKind: 'aggregate',
          parentNodeId: node.id,
        });
        const aggregateRequest = createPlaywrightExecutionRequest(node, {
          blobArtifacts,
          executionMode: 'aggregate',
          outputNodeId: node.id,
          runtimeNodeId: aggregateNodeId,
          sourceRevision: discovery.sourceRevision,
        }).request;
        const aggregateResult =
          await runPreparedPlaywrightRequest(aggregateRequest);
        const shardFailed = shardResults.some(
          (result) => result.outcome === 'error',
        );
        return {
          outcome:
            shardFailed || aggregateResult.outcome === 'error'
              ? ('error' as const)
              : ('success' as const),
          output: {
            ...aggregateResult.output,
            discovery,
            plan,
            shards: shardResults.map((result) => ({
              ...result.child,
              outcome: result.outcome,
              output: result.output,
              ...('error' in result ? { error: result.error } : {}),
            })),
          },
        };
      };

      const nodeHasRun: Record<string, boolean> = {};
      const nodeIsRunning: Record<string, boolean> = {};
      let activeNodeCount = 0;

      // Start a node immediately if it hasn't already started. The DAG drives
      // parallelism: a node is triggered when its parent completes (or starts,
      // for `concurrent` edges), so sibling branches that share a parent all
      // fire at the same moment and run in parallel.
      const runNode = (nodeId: string) => {
        if (nodeHasRun[nodeId] || nodeIsRunning[nodeId]) {
          return;
        }
        void processNode(nodeId).catch(console.error);
      };

      const runConnectionTargets = (
        connectionsToTrigger: Array<{ targetId: string }>,
      ) => {
        const targetIds = Array.from(
          new Set(connectionsToTrigger.map((conn) => conn.targetId)),
        );
        for (const targetId of targetIds) {
          runNode(targetId);
        }
      };

      const processNode = async (nodeId: string) => {
        if (nodeHasRun[nodeId] || nodeIsRunning[nodeId]) {
          return;
        }

        const node = workflowNodes.find(
          (candidate: any) => candidate.id === nodeId,
        );
        if (!node) return;

        nodeIsRunning[nodeId] = true;
        activeNodeCount++;
        const type = packageExecutorRuntime.nodeType(node);
        const outgoing = processedConnections.filter(
          (c) => c.sourceId === node.id,
        );
        let finalState: 'success' | 'error' | 'warning' = 'success';

        try {
          await publishNodeState(
            node.id,
            type === 'playwright' || type === 'agent-container'
              ? 'pending'
              : 'running',
          );
          prepareWorkflowRunStatusForNode({
            activeNodeCount,
            outgoingCount: outgoing.length,
            workflow: workflowContext,
          });
          const concurrentChildren = outgoing.filter(
            (c) => (c.type || 'sequential') === 'concurrent',
          );
          runConnectionTargets(concurrentChildren);

          if (type === 'environment' || type === 'schedule') {
            await publishLog(
              `Processing node: ${node.label} (${node.id})`,
              'info',
              { nodeId: node.id },
            );
          } else if (type === 'agent-container') {
            const request = createAgentExecutionRequest(node);
            const publishAttachmentState = async (
              state: 'error' | 'warning',
              message: string,
            ) => {
              const timestamp = new Date().toISOString();
              await Promise.allSettled([
                request.publishEvent({
                  level: state === 'error' ? 'error' : 'warn',
                  message,
                  nodeId: node.id,
                  timestamp,
                  type: 'log',
                }),
                request.publishEvent({
                  nodeId: request.agent.nodeId,
                  parentNodeId: node.id,
                  state,
                  timestamp,
                  type: 'node_state',
                }),
                ...request.validators.map((validator) =>
                  request.publishEvent({
                    nodeId: validator.nodeId,
                    parentNodeId: node.id,
                    state,
                    timestamp,
                    type: 'node_state',
                  }),
                ),
              ]);
            };
            await publishLog(
              `Processing node: ${node.label} (${node.id})`,
              'info',
              { nodeId: node.id },
            );
            if (request.envKeys.length) {
              await publishLog(
                `Injecting Environment Variables: ${request.envKeys.map((key) => `${key}=***`).join(', ')}`,
                'info',
                { nodeId: node.id },
              );
            }
            let preparedRunner;
            try {
              preparedRunner =
                await orchestratorRuntime.agentExecution.prepare(request);
            } catch (error) {
              await publishAttachmentState(
                'error',
                `AI Container preparation failed: ${getErrorMessage(error)}`,
              );
              throw error;
            }
            const activeKey = activeExecutionKey(testId, node.id);
            let cancellationRequested = false;
            activePreparedRunners.set(activeKey, {
              cancel: async () => {
                cancellationRequested = true;
                await (
                  preparedRunner.cancel ||
                  preparedRunner.cleanup ||
                  (async () => undefined)
                )();
              },
              executionId: testId,
              nodeId: node.id,
              runtimeNodeId: node.id,
            });
            try {
              await preparedRunner.waitUntilReady();
              if (cancellationRequested) {
                throw new Error('AI Container runner was cancelled.');
              }
              await publishNodeState(node.id, 'running');
              if (cancellationRequested) {
                throw new Error('AI Container runner was cancelled.');
              }
              await preparedRunner.start();
              const result = await preparedRunner.waitForCompletion();
              for (const entry of result.diagnosticLogs || []) {
                captureDiagnosticLog({
                  ...entry,
                  ...(entry.nodeId && entry.nodeId !== node.id
                    ? { parentNodeId: node.id }
                    : {}),
                });
              }
              nodeTemplateOutputs[`node_${node.id}`] = result.output;
              const completedAt = new Date().toISOString();
              const botPullRequestEvent = createBotPullRequestWorkflowEvent(
                result,
                request.changeContext,
              );
              await publishEventStrict({
                nodeId: node.id,
                output: result.output,
                timestamp: completedAt,
                type: 'node_output',
              });
              if (botPullRequestEvent) {
                await publishEventStrict({
                  ...botPullRequestEvent,
                  nodeId: node.id,
                  timestamp: completedAt,
                });
              }
              finalState = result.outcome;
            } catch (error) {
              if (!cancellationRequested) {
                await publishAttachmentState(
                  'error',
                  `AI Container failed: ${getErrorMessage(error)}`,
                );
              }
              throw error;
            } finally {
              activePreparedRunners.delete(activeKey);
              await preparedRunner.cleanup?.();
            }
          } else if (type === 'playwright') {
            const { cpu, injectedEnv, memory, request, workers } =
              createPlaywrightExecutionRequest(node);
            const shardingMode = resolvePlaywrightShardingMode(
              getRecord(node.config),
            );

            await publishLog(
              `Processing node: ${node.label} (${node.id})`,
              'info',
              { nodeId: node.id },
            );
            await publishLog(
              `Waiting for prepared Playwright Runner with resources: CPU ${cpu}, Memory ${memory}GB, Workers ${workers}`,
              'build',
              { nodeId: node.id },
            );
            if (injectedEnv) {
              await publishLog(
                `Injecting Environment Variables: ${injectedEnv}`,
                'info',
                { nodeId: node.id },
              );
            }

            console.log(
              `[Orchestrator] Sending payload to runner for ${node.id}:`,
              JSON.stringify(
                redactSensitivePayload(request.payloadData),
                null,
                2,
              ),
            );
            if (!settings?.github?.accessToken) {
              console.warn(
                '[Orchestrator WARNING] No GitHub accessToken found in settings. settings.github keys:',
                settings?.github ? Object.keys(settings.github) : 'null',
              );
            }

            try {
              if (shardingMode !== 'off') {
                await publishNodeState(node.id, 'running');
                const result = await executeShardedPlaywrightNode(node);
                nodeTemplateOutputs[`node_${node.id}`] = result.output;
                await publishEvent({
                  nodeId: node.id,
                  output: result.output,
                  timestamp: new Date().toISOString(),
                  type: 'node_output',
                });
                finalState = result.outcome;
              } else {
                const preparedRunner =
                  (await preparedPlaywrightRunners[node.id]) ||
                  (await orchestratorRuntime.playwrightExecution.prepare(
                    request,
                  ));
                delete preparedPlaywrightRunners[node.id];
                activePreparedRunners.delete(
                  activeExecutionKey(testId, node.id),
                );
                const result = await runPreparedPlaywrightRequest(
                  request,
                  preparedRunner,
                );
                nodeTemplateOutputs[`node_${node.id}`] = result.output;
                finalState = result.outcome;
              }
            } catch (error) {
              throw new Error(
                `Playwright Runner failed: ${getErrorMessage(error)}`,
              );
            }
          } else {
            await publishLog(
              `Processing node: ${node.label} (${node.id})`,
              'info',
              { nodeId: node.id },
            );
            const result = await packageExecutorRuntime.execute({
              executionId: testId,
              workflowId: workflowContext.definition.id,
              node,
              settings,
              env: globalEnvVars,
              nodeOutputs: nodeTemplateOutputs,
              workflow: workflowContext as unknown as Record<string, unknown>,
              renderTemplate: (value) =>
                renderNodeTemplate(value, {
                  env: globalEnvVars,
                  nodeLogs: nodeDiagnosticLogs,
                  nodeOutputs: nodeTemplateOutputs,
                  workflow: workflowContext,
                }),
              log: (message, level) =>
                publishLog(message, level, { nodeId: node.id }),
            });
            finalState = result.outcome;

            if (result.output !== undefined) {
              nodeTemplateOutputs[`node_${node.id}`] = result.output;
              await publishEvent({
                nodeId: node.id,
                output: result.output,
                timestamp: new Date().toISOString(),
                type: 'node_output',
              });
            }
          }
        } catch (error) {
          finalState = 'error';
          await publishLog(getErrorMessage(error), 'error', {
            nodeId: node.id,
          });
        } finally {
          try {
            await publishNodeState(node.id, finalState);
            if (finalState === 'error') {
              workflowFailed = true;
              markWorkflowRunFailed(workflowContext, node);
            }
          } catch (finalizationError) {
            console.error(
              `Failed to finalize workflow node ${node.id}:`,
              finalizationError,
            );
          } finally {
            nodeIsRunning[nodeId] = false;
            nodeHasRun[nodeId] = true;
            activeNodeCount--;
          }
        }

        const hasConditionals = outgoing.some(
          (c) => c.type === 'success' || c.type === 'failure',
        );
        const isSuccess =
          (finalState as string) === 'success' ||
          (finalState as string) === 'warning';
        const postCompletionChildren: typeof outgoing = [];

        for (const conn of outgoing) {
          const connType = conn.type || 'sequential';
          let shouldTrigger = false;

          if (connType === 'concurrent') {
            continue;
          } else if (connType === 'sequential') {
            if (hasConditionals) {
              shouldTrigger = isSuccess;
            } else {
              shouldTrigger = true;
            }
          } else if (connType === 'success') {
            shouldTrigger = isSuccess;
          } else if (connType === 'failure') {
            shouldTrigger = !isSuccess;
          } else if (connType === 'independent') {
            shouldTrigger = true;
          }

          if (shouldTrigger) {
            postCompletionChildren.push(conn);
          }
        }

        runConnectionTargets(postCompletionChildren);
      };

      const incomingCount: Record<string, number> = {};
      for (const node of workflowNodes) {
        incomingCount[node.id] = 0;
      }
      for (const conn of processedConnections) {
        if (incomingCount[conn.targetId] !== undefined) {
          incomingCount[conn.targetId]++;
        }
      }
      const startNodes = workflowNodes
        .filter((n: any) => incomingCount[n.id] === 0)
        .map((n: any) => n.id);

      startNodes.forEach((startNodeId: string) => runNode(startNodeId));

      while (activeNodeCount > 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    finishWorkflowRun(workflowContext, workflowFailed ? 'failed' : 'completed');
    terminalEventAttempted = true;
    await publishTerminalEvent({
      level: workflowFailed ? 'error' : 'info',
      message: workflowFailed
        ? 'Workflow execution failed.'
        : 'Workflow execution completed.',
      timestamp: new Date().toISOString(),
      type: workflowFailed ? 'workflow_failed' : 'workflow_completed',
      workflow: workflowContext,
    });
  } catch (err: any) {
    if (!terminalEventAttempted) {
      markWorkflowRunFailed(workflowContext);
      terminalEventAttempted = true;
      await publishTerminalEvent({
        level: 'error',
        message: `Workflow execution failed: ${err?.message || 'Unknown error'}`,
        timestamp: new Date().toISOString(),
        type: 'workflow_failed',
        workflow: workflowContext,
      });
    }
    throw err;
  } finally {
    await Promise.allSettled(
      Object.entries(preparedPlaywrightRunners).map(
        async ([nodeId, runnerPromise]) => {
          try {
            const runner = await runnerPromise;
            await runner.cleanup?.();
          } finally {
            activePreparedRunners.delete(
              activeExecutionKey(reqBody.testId, nodeId),
            );
            delete preparedPlaywrightRunners[nodeId];
          }
        },
      ),
    );
  }
}

const executeRequestCoordinator = new ExecuteRequestCoordinator(
  async (payload) => executeWorkflow(payload),
  (error) => {
    console.error('Workflow execution failed:', error);
  },
);

app.post('/execute', requireOrchestratorAuth, (req, res) => {
  const admission = executeRequestCoordinator.admit(req.body);
  try {
    res.status(admission.statusCode).json(admission.body);
  } finally {
    void admission.start?.();
  }
});

app.get('/health', (req, res) => {
  res.status(200).send('Runner is healthy and in standby.');
});

app.get('/runtime', requireOrchestratorAuth, (req, res) => {
  const executorDiagnostics = packageExecutorRuntime.diagnostics();

  res.status(200).json({
    activePackageExecutorCount: executorDiagnostics.activeExecutions.length,
    eventTransport: 'pubsub',
    localAuth: process.env.PLAYRUNNER_ORCHESTRATOR_AUTH_TOKEN?.trim()
      ? 'required'
      : 'disabled',
    orchestratorContributions: executorDiagnostics.contributions,
    orchestratorExecutorTimeoutMs: executorDiagnostics.timeoutMs,
    pubsubEmulatorHost: process.env.PUBSUB_EMULATOR_HOST || null,
    runnerControl: 'pubsub',
    service: 'playrunner-orchestrator',
    workflowEventsTopic:
      process.env.GCP_PUBSUB_WORKFLOW_EVENTS_TOPIC ||
      'playrunner-workflow-events',
  });
});

app.post('/stop', requireOrchestratorAuth, async (req, res) => {
  const nodeId = getString(req.body?.nodeId);
  const requestedExecutionId =
    getString(req.body?.executionId) || getString(req.body?.testId);
  if (!nodeId) return res.status(400).json({ error: 'nodeId required' });

  const packageMatches = packageExecutorRuntime
    .diagnostics()
    .activeExecutions.filter(
      (active) =>
        active.nodeId === nodeId &&
        (!requestedExecutionId || active.executionId === requestedExecutionId),
    );
  const processMatches = Array.from(activeProcesses.values()).filter(
    (active) =>
      active.nodeId === nodeId &&
      (!requestedExecutionId || active.executionId === requestedExecutionId),
  );
  const preparedRunnerMatches = Array.from(
    activePreparedRunners.values(),
  ).filter(
    (active) =>
      active.nodeId === nodeId &&
      (!requestedExecutionId || active.executionId === requestedExecutionId),
  );
  const matchingExecutionIds = new Set([
    ...packageMatches.map((active) => active.executionId),
    ...processMatches.map((active) => active.executionId),
    ...preparedRunnerMatches.map((active) => active.executionId),
  ]);

  if (!requestedExecutionId && matchingExecutionIds.size > 1) {
    return res.status(409).json({
      error:
        'Multiple executions are running this node. executionId is required.',
    });
  }

  const executionId =
    requestedExecutionId || matchingExecutionIds.values().next().value;
  if (!executionId) {
    return res.status(404).json({ error: 'Node not running' });
  }

  const cancelledExecutors = packageExecutorRuntime.cancel({
    executionId,
    nodeId,
  });
  let stoppedProcesses = 0;
  for (const active of processMatches) {
    if (active.executionId !== executionId) {
      continue;
    }

    await active.publisher.publishLog(
      `Stopping execution for node: ${nodeId}...`,
      'warn',
    );
    active.process.kill('SIGTERM');
    stoppedProcesses++;
  }

  const preparedRunnerCancellation = await cancelPreparedRunnerMatches(
    preparedRunnerMatches.filter(
      (active) => active.executionId === executionId,
    ),
  );

  if (preparedRunnerCancellation.failureResponse) {
    return res
      .status(preparedRunnerCancellation.failureResponse.status)
      .json({ error: preparedRunnerCancellation.failureResponse.error });
  }

  if (
    cancelledExecutors === 0 &&
    stoppedProcesses === 0 &&
    preparedRunnerCancellation.cancelled === 0
  ) {
    return res.status(404).json({ error: 'Node not running' });
  }

  return res.status(200).json({
    executionId,
    status: 'stopped',
  });
});

async function start() {
  await orchestratorRuntime.ready;
  console.log(`Standby Runner listening on port ${PORT}`);

  app.listen(PORT, () => {
    console.log('Runner started and is now in standby ready for workflows.');
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error('Failed to start orchestrator runtime:', error);
    process.exit(1);
  });
}
