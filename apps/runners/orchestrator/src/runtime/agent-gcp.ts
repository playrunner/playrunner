import crypto from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';
import {
  AGENT_BOOTSTRAP_ENVIRONMENT_VARIABLE,
  MAX_AGENT_BOOTSTRAP_BYTES,
  serializeAgentBootstrap,
  type AgentBootstrap,
} from '../../../shared/agent-bootstrap';
import { withRunnerProtocolSignature } from '../../../shared/runner-protocol';
import type {
  AgentExecutionBackend,
  AgentExecutionRequest,
  AgentExecutionResult,
  PreparedAgentRunner,
} from './contracts';
import {
  createAgentRunnerPayload,
  validateAgentExecutionResult,
} from './agent-local';
import {
  cloudRunRequest,
  createDurableCloudRunCancellation,
  getExecutionNameFromOperation,
  waitForOperation,
  type CloudRunOperation,
} from './playwright-gcp';
import {
  createPubSubRunnerControl,
  resolveWorkflowEventsTopicName,
  type PubSubRunnerControl,
} from './pubsub-runner-control';

type CloudRunExecution = {
  conditions?: Array<{ state?: string; type?: string }>;
  createTime?: string;
  metadata?: { creationTimestamp?: string };
  name?: string;
  parallelism?: number;
  taskCount?: number;
  template?: {
    containers?: Array<{
      env?: Array<{ name?: string; value?: string }>;
      name?: string;
    }>;
  };
};

type CloudRunExecutionsList = { executions?: CloudRunExecution[] };

type CloudRunJob = {
  etag?: string;
  name?: string;
  template?: {
    parallelism?: number;
    taskCount?: number;
    template?: {
      containers?: Array<{
        args?: string[];
        command?: string[];
        env?: Array<{ name?: string; value?: string }>;
        image?: string;
        name?: string;
        resources?: {
          limits?: Record<string, string>;
          startupCpuBoost?: boolean;
        };
      }>;
      maxRetries?: number;
      serviceAccount?: string;
      timeout?: string;
    };
  };
};

type GcpAgentRunSettings = {
  accessToken: string;
  cloudRunLocation: string;
  cpu: number;
  imageUri: string;
  jobName: string;
  memory: number;
  maxDurationMinutes: number;
  controlServiceAccount: string;
  orchestratorRuntimeServiceAccount: string;
  projectId: string;
  serviceAccount: string;
  topicName: string;
};

const AGENT_TASK_TIMEOUT = '3300s';
const DEFAULT_AGENT_JOB_NAME_TEMPLATE = 'playrunner-agent';
const EXECUTION_COMPLETION_TIMEOUT_MS = 60 * 60 * 1000;
const EXECUTION_START_TIMEOUT_MS = 2 * 60 * 1000;
const AGENT_READY_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_HOSTED_AGENT_DURATION_MINUTES = 30;
const MAX_HOSTED_AGENT_DURATION_MINUTES = 45;
const AGENT_CONTROL_TOKEN_LIFETIME_SECONDS = 60 * 60;
const POLL_INTERVAL_MS = 3000;
const ALLOWED_AGENT_CPUS = new Set([1, 2, 4, 8]);
const ALLOWED_AGENT_MEMORY_GB = new Set([2, 4, 8, 16, 32]);
let agentJobConfigurationQueue = Promise.resolve();

function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function requireSetting(value: unknown, name: string): string {
  const setting = typeof value === 'string' ? value.trim() : '';
  if (!setting) throw new Error(`${name} must be configured in GCP settings.`);
  return setting;
}

function requireResourceSegment(value: unknown, name: string): string {
  const segment = requireSetting(value, name);
  if (
    segment.length > 255 ||
    segment.includes('/') ||
    segment.includes('\\') ||
    Array.from(segment).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 32 || code === 127;
    })
  ) {
    throw new Error(`${name} is invalid for GCP AI Container execution.`);
  }
  return segment;
}

function renderTemplate(
  template: string,
  values: Record<string, string | number>,
): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

function normalizeCloudRunJobName(value: string, fallback: string): string {
  const normalized = value
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const prefixed = /^[a-z]/.test(normalized) ? normalized : `job-${normalized}`;
  return prefixed.slice(0, 63).replace(/-+$/g, '') || fallback;
}

function nodeJobSuffix(nodeId: string): string {
  const slug = normalizeCloudRunJobName(nodeId, 'node')
    .replace(/^job-/, '')
    .slice(0, 16)
    .replace(/-+$/g, '');
  const hash = crypto
    .createHash('sha1')
    .update(nodeId)
    .digest('hex')
    .slice(0, 8);
  return `${slug || 'node'}-${hash}`;
}

function resolveJobName(
  template: string,
  nodeId: string,
  cpu: number,
  memory: number,
  imageUri: string,
): string {
  const imageHash = crypto
    .createHash('sha256')
    .update(imageUri)
    .digest('hex')
    .slice(0, 8);
  const rendered = renderTemplate(template, {
    cpu,
    imageHash,
    memory,
    nodeId,
  });
  const baseName = normalizeCloudRunJobName(rendered, 'playrunner-agent');
  const suffix = `${nodeJobSuffix(nodeId)}-${cpu}c-${memory}g-${imageHash}`;
  const maximumBaseLength = Math.max(1, 63 - suffix.length - 1);
  const trimmedBase =
    normalizeCloudRunJobName(
      baseName.slice(0, maximumBaseLength),
      'playrunner-agent',
    ).replace(/-+$/g, '') || 'playrunner-agent';
  return normalizeCloudRunJobName(
    `${trimmedBase}-${suffix}`,
    'playrunner-agent',
  );
}

function configuredResource(
  value: unknown,
  allowed: ReadonlySet<number>,
  fallback: number,
  name: string,
): number {
  if (value === undefined || value === null || value === '') return fallback;
  const configured = Number(value);
  if (!allowed.has(configured)) {
    throw new Error(
      `${name} must be one of ${[...allowed].join(', ')} for GCP AI Container execution.`,
    );
  }
  return configured;
}

export function resolveHostedAgentDurationMinutes(value: unknown): number {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_HOSTED_AGENT_DURATION_MINUTES;
  }
  const duration = Number(value);
  if (
    !Number.isInteger(duration) ||
    duration < 1 ||
    duration > MAX_HOSTED_AGENT_DURATION_MINUTES
  ) {
    throw new Error(
      `Hosted GCP AI Container maxDurationMinutes must be an integer from 1 to ${MAX_HOSTED_AGENT_DURATION_MINUTES}; short-lived runner control credentials cannot safely support longer runs.`,
    );
  }
  return duration;
}

function defaultAgentImageTemplate(location: string): string {
  return `${location}-docker.pkg.dev/{projectId}/agent-runner/playrunner-agent-runner:latest`;
}

export async function refreshGcpAccessTokenForAgent(
  gcpSettings: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<string> {
  const currentToken = requireSetting(
    gcpSettings.accessToken,
    'GCP access token',
  );
  const expiresAt = Number(gcpSettings.expiresAt);
  if (Number.isFinite(expiresAt) && expiresAt - now() >= 55 * 60 * 1000) {
    return currentToken;
  }
  const clientId = requireSetting(gcpSettings.clientId, 'GCP OAuth client ID');
  const clientSecret = requireSetting(
    gcpSettings.clientSecret,
    'GCP OAuth client secret',
  );
  const refreshToken = requireSetting(
    gcpSettings.refreshToken,
    'GCP OAuth refresh token',
  );
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const accessToken =
    typeof data.access_token === 'string' ? data.access_token.trim() : '';
  const expiresIn = Number(data.expires_in);
  if (
    !response.ok ||
    !accessToken ||
    accessToken.length > 16 * 1024 ||
    accessToken.includes('\0') ||
    !Number.isFinite(expiresIn) ||
    expiresIn < 55 * 60 ||
    expiresIn > 24 * 60 * 60
  ) {
    throw new Error(
      `Could not refresh a sufficiently-lived server-side GCP access token for AI Container control (${response.status}).`,
    );
  }
  return accessToken;
}

function resolveGcpAgentRunSettings(
  request: AgentExecutionRequest,
): GcpAgentRunSettings {
  const gcpSettings = request.reqBody.settings?.gcp || {};
  const projectId = requireResourceSegment(
    request.reqBody.gcpProject,
    'gcpProject',
  );
  const accessToken = requireSetting(
    gcpSettings.accessToken,
    'GCP access token',
  );
  const cloudRunLocation = requireResourceSegment(
    gcpSettings.cloudRunLocation,
    'Cloud Run region',
  );
  const template =
    typeof gcpSettings.agentImageUriTemplate === 'string' &&
    gcpSettings.agentImageUriTemplate.trim()
      ? gcpSettings.agentImageUriTemplate.trim()
      : defaultAgentImageTemplate(cloudRunLocation);
  const imageUri = renderTemplate(template, { projectId });
  if (!imageUri || /[\s\0]/.test(imageUri)) {
    throw new Error('Agent image URI template is invalid in GCP settings.');
  }
  const cpu = configuredResource(
    request.config.cpu,
    ALLOWED_AGENT_CPUS,
    4,
    'AI Container CPU',
  );
  const memory = configuredResource(
    request.config.memory,
    ALLOWED_AGENT_MEMORY_GB,
    8,
    'AI Container memory',
  );
  if (memory > cpu * 4) {
    throw new Error(
      `AI Container memory ${memory} GiB exceeds the ${cpu} CPU Cloud Run limit of ${cpu * 4} GiB.`,
    );
  }
  return {
    accessToken,
    cloudRunLocation,
    cpu,
    imageUri,
    jobName: resolveJobName(
      typeof gcpSettings.agentJobNameTemplate === 'string' &&
        gcpSettings.agentJobNameTemplate.trim()
        ? gcpSettings.agentJobNameTemplate.trim()
        : DEFAULT_AGENT_JOB_NAME_TEMPLATE,
      request.nodeId,
      cpu,
      memory,
      imageUri,
    ),
    memory,
    maxDurationMinutes: resolveHostedAgentDurationMinutes(
      request.config.maxDurationMinutes,
    ),
    controlServiceAccount: `playrunner-agent-control@${projectId}.iam.gserviceaccount.com`,
    orchestratorRuntimeServiceAccount: `playrunner-orchestrator-runtime@${projectId}.iam.gserviceaccount.com`,
    projectId,
    serviceAccount: `playrunner-agent-runner@${projectId}.iam.gserviceaccount.com`,
    topicName: resolveWorkflowEventsTopicName(
      request.reqBody.eventTransport?.topicName,
    ),
  };
}

export function createAgentCloudRunJobBody(args: {
  cpu: number;
  imageUri: string;
  memory: number;
  serviceAccount: string;
}): Record<string, unknown> {
  return {
    template: {
      parallelism: 1,
      taskCount: 1,
      template: {
        containers: [
          {
            image: args.imageUri,
            name: 'agent',
            resources: {
              limits: {
                cpu: `${args.cpu}`,
                memory: `${args.memory}Gi`,
              },
              startupCpuBoost: true,
            },
          },
        ],
        maxRetries: 0,
        serviceAccount: args.serviceAccount,
        timeout: AGENT_TASK_TIMEOUT,
      },
    },
  };
}

export function createAgentCloudRunRunBody(
  bootstrap: AgentBootstrap,
  etag?: string,
): Record<string, unknown> {
  return {
    ...(etag ? { etag } : {}),
    overrides: {
      containerOverrides: [
        {
          env: [
            {
              name: AGENT_BOOTSTRAP_ENVIRONMENT_VARIABLE,
              value: serializeAgentBootstrap(bootstrap),
            },
          ],
          name: 'agent',
        },
      ],
    },
  };
}

export function agentJobMatchesSettings(
  value: unknown,
  settings: Pick<
    GcpAgentRunSettings,
    'cpu' | 'imageUri' | 'memory' | 'serviceAccount'
  >,
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const job = value as CloudRunJob;
  const executionTemplate = job.template;
  const task = executionTemplate?.template;
  const containers = task?.containers || [];
  const container = containers.find((candidate) => candidate.name === 'agent');
  const limits = container?.resources?.limits || {};
  return (
    container?.image === settings.imageUri &&
    containers.length === 1 &&
    limits.cpu === `${settings.cpu}` &&
    limits.memory === `${settings.memory}Gi` &&
    !container.args?.length &&
    !container.command?.length &&
    !container.env?.length &&
    executionTemplate?.parallelism === 1 &&
    executionTemplate.taskCount === 1 &&
    task?.maxRetries === 0 &&
    task.serviceAccount === settings.serviceAccount &&
    task.timeout === AGENT_TASK_TIMEOUT
  );
}

type PubSubIamPolicy = {
  bindings?: Array<{
    condition?: unknown;
    members?: string[];
    role?: string;
  }>;
  etag?: string;
  version?: number;
};

export function withAgentControlPubSubRole(
  policy: PubSubIamPolicy | null | undefined,
  controlServiceAccount: string,
  role: 'roles/pubsub.publisher' | 'roles/pubsub.subscriber',
): PubSubIamPolicy {
  const member = `serviceAccount:${controlServiceAccount}`;
  const bindings = (policy?.bindings || [])
    .map((binding) => ({
      ...binding,
      members: (binding.members || []).filter(
        (candidate) => candidate !== member,
      ),
    }))
    .filter((binding) => binding.members.length > 0);
  let target = bindings.find(
    (binding) => binding.role === role && binding.condition === undefined,
  );
  if (!target) {
    target = { members: [], role };
    bindings.push(target);
  }
  target.members = Array.from(new Set([...(target.members || []), member]));
  return { ...(policy || {}), bindings };
}

async function pubSubIamRequest<T>(
  resourceName: string,
  method: 'getIamPolicy' | 'setIamPolicy',
  accessToken: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(
    `https://pubsub.googleapis.com/v1/${resourceName}:${method}`,
    {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
    },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Pub/Sub IAM API returned ${response.status}: ${text.slice(0, 500)}`,
    );
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export async function ensureAgentControlPubSubRole(
  args: {
    accessToken: string;
    controlServiceAccount: string;
    resourceName: string;
    role: 'roles/pubsub.publisher' | 'roles/pubsub.subscriber';
  },
  request: typeof pubSubIamRequest = pubSubIamRequest,
  wait: (milliseconds: number) => Promise<void> = sleep,
): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await request<PubSubIamPolicy>(
      args.resourceName,
      'getIamPolicy',
      args.accessToken,
      { options: { requestedPolicyVersion: 3 } },
    );
    const desired = withAgentControlPubSubRole(
      current,
      args.controlServiceAccount,
      args.role,
    );
    let updated: PubSubIamPolicy;
    try {
      updated = await request<PubSubIamPolicy>(
        args.resourceName,
        'setIamPolicy',
        args.accessToken,
        { policy: desired },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        attempt < 3 &&
        (/\b409\b/.test(message) || /\bABORTED\b/i.test(message))
      ) {
        await wait(25 * 2 ** attempt);
        continue;
      }
      throw error;
    }
    const member = `serviceAccount:${args.controlServiceAccount}`;
    const memberBindings = (updated.bindings || []).filter((binding) =>
      (binding.members || []).includes(member),
    );
    if (
      memberBindings.length !== 1 ||
      memberBindings[0].role !== args.role ||
      memberBindings[0].condition !== undefined
    ) {
      throw new Error(
        `Pub/Sub did not apply the scoped ${args.role} binding for the AI Container control identity.`,
      );
    }
    return;
  }
  throw new Error('Pub/Sub IAM policy reconciliation exhausted its retries.');
}

type GoogleDefaultIdentity = Pick<GoogleAuth, 'getClient' | 'getCredentials'>;

export async function mintAgentControlAccessToken(
  {
    controlServiceAccount,
    orchestratorRuntimeServiceAccount,
  }: Pick<
    GcpAgentRunSettings,
    'controlServiceAccount' | 'orchestratorRuntimeServiceAccount'
  >,
  googleAuth: GoogleDefaultIdentity = new GoogleAuth(),
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const credentials = await googleAuth.getCredentials();
  if (
    credentials.client_email?.trim().toLowerCase() !==
    orchestratorRuntimeServiceAccount.toLowerCase()
  ) {
    throw new Error(
      'Orchestrator Application Default Credentials do not match the dedicated roleless runtime service account.',
    );
  }
  const url = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(controlServiceAccount)}:generateAccessToken`;
  const sourceClient = await googleAuth.getClient();
  const sourceHeaders = await sourceClient.getRequestHeaders(url);
  const authorization = sourceHeaders.get('authorization')?.trim() || '';
  if (!/^Bearer \S+$/.test(authorization)) {
    throw new Error(
      'Orchestrator Application Default Credentials did not provide an access token.',
    );
  }
  const response = await fetchImpl(url, {
    body: JSON.stringify({
      lifetime: `${AGENT_CONTROL_TOKEN_LIFETIME_SECONDS}s`,
      scope: ['https://www.googleapis.com/auth/pubsub'],
    }),
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
    },
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw new Error(
      `IAM Credentials API returned ${response.status}: ${JSON.stringify(data).slice(0, 500)}`,
    );
  }
  const accessToken =
    typeof data.accessToken === 'string' ? data.accessToken.trim() : '';
  const expiresAt =
    typeof data.expireTime === 'string' ? Date.parse(data.expireTime) : NaN;
  const remainingMs = expiresAt - Date.now();
  if (
    !accessToken ||
    accessToken.length > 16 * 1024 ||
    accessToken.includes('\0') ||
    !Number.isFinite(expiresAt) ||
    remainingMs < 55 * 60 * 1000 ||
    remainingMs > (AGENT_CONTROL_TOKEN_LIFETIME_SECONDS + 60) * 1000
  ) {
    throw new Error(
      'IAM Credentials API returned an invalid or insufficiently-lived AI Container control token.',
    );
  }
  return accessToken;
}

async function getAgentJob(
  jobPath: string,
  accessToken: string,
): Promise<CloudRunJob | null> {
  try {
    return await cloudRunRequest<CloudRunJob>(jobPath, accessToken);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('Cloud Run API returned 404')
    ) {
      return null;
    }
    throw error;
  }
}

async function withAgentJobConfigurationLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const previous = agentJobConfigurationQueue;
  let release!: () => void;
  agentJobConfigurationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
  }
}

function preparedAgentJob(
  jobPath: string,
  job: CloudRunJob,
  settings: GcpAgentRunSettings,
): { etag: string; jobPath: string } {
  if (!agentJobMatchesSettings(job, settings)) {
    throw new Error(
      `AI Container Cloud Run Job ${settings.jobName} does not match the required isolated configuration.`,
    );
  }
  const etag = typeof job.etag === 'string' ? job.etag.trim() : '';
  if (!etag || etag.length > 1024 || etag.includes('\0')) {
    throw new Error(
      `AI Container Cloud Run Job ${settings.jobName} did not provide a valid concurrency token.`,
    );
  }
  return { etag, jobPath };
}

async function ensureAgentJob(
  settings: GcpAgentRunSettings,
  publishLog: AgentExecutionRequest['publishLog'],
): Promise<{ etag: string; jobPath: string }> {
  const parentPath = `projects/${settings.projectId}/locations/${settings.cloudRunLocation}`;
  const jobPath = `${parentPath}/jobs/${settings.jobName}`;
  await publishLog(
    `Ensuring AI Container Cloud Run Job ${settings.jobName} is configured.`,
    'info',
  );
  const existing = await getAgentJob(jobPath, settings.accessToken);
  if (existing && agentJobMatchesSettings(existing, settings)) {
    return preparedAgentJob(jobPath, existing, settings);
  }

  const body = JSON.stringify({
    ...(existing ? { name: jobPath } : {}),
    ...createAgentCloudRunJobBody(settings),
  });
  let operation: CloudRunOperation;
  try {
    operation = await cloudRunRequest<CloudRunOperation>(
      existing ? jobPath : `${parentPath}/jobs?jobId=${settings.jobName}`,
      settings.accessToken,
      { body, method: existing ? 'PATCH' : 'POST' },
    );
  } catch (error) {
    if (
      existing ||
      !(error instanceof Error) ||
      !error.message.includes('Cloud Run API returned 409')
    ) {
      throw error;
    }
    const startedAt = Date.now();
    while (Date.now() - startedAt < EXECUTION_START_TIMEOUT_MS) {
      const concurrentlyCreated = await getAgentJob(
        jobPath,
        settings.accessToken,
      );
      if (concurrentlyCreated) {
        if (!agentJobMatchesSettings(concurrentlyCreated, settings)) {
          throw new Error(
            `Concurrent creation produced an incompatible AI Container Cloud Run Job ${settings.jobName}.`,
          );
        }
        return preparedAgentJob(jobPath, concurrentlyCreated, settings);
      }
      await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(
      `Timed out reconciling concurrent creation of AI Container Cloud Run Job ${settings.jobName}.`,
    );
  }
  await waitForOperation(operation.name, settings.accessToken);
  await publishLog(
    `AI Container Cloud Run Job ${settings.jobName} ${existing ? 'updated' : 'created'}.`,
    'info',
  );
  const configuredJob = await getAgentJob(jobPath, settings.accessToken);
  if (!configuredJob) {
    throw new Error(
      `AI Container Cloud Run Job ${settings.jobName} was not readable after configuration.`,
    );
  }
  return preparedAgentJob(jobPath, configuredJob, settings);
}

function executionCreateTime(execution: CloudRunExecution): number {
  const timestamp =
    execution.createTime || execution.metadata?.creationTimestamp || '';
  const parsed = timestamp ? Date.parse(timestamp) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function constantTimeStringEquals(value: unknown, expected: string): boolean {
  if (typeof value !== 'string') return false;
  const actualBytes = Buffer.from(value, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return (
    actualBytes.length === expectedBytes.length &&
    crypto.timingSafeEqual(actualBytes, expectedBytes)
  );
}

function executionMatchesBootstrap(
  execution: CloudRunExecution,
  bootstrap: AgentBootstrap,
): boolean {
  if (execution.parallelism !== 1 || execution.taskCount !== 1) return false;
  const containers = execution.template?.containers || [];
  if (containers.length !== 1 || containers[0].name !== 'agent') return false;
  const bootstrapVariable = containers[0].env?.find(
    (variable) => variable.name === AGENT_BOOTSTRAP_ENVIRONMENT_VARIABLE,
  );
  if (
    typeof bootstrapVariable?.value !== 'string' ||
    Buffer.byteLength(bootstrapVariable.value, 'utf8') >
      MAX_AGENT_BOOTSTRAP_BYTES
  ) {
    return false;
  }
  let candidate: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(bootstrapVariable.value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return false;
    }
    candidate = parsed as Record<string, unknown>;
  } catch {
    return false;
  }
  const runnerControl =
    candidate.runnerControl &&
    typeof candidate.runnerControl === 'object' &&
    !Array.isArray(candidate.runnerControl)
      ? (candidate.runnerControl as Record<string, unknown>)
      : {};
  return (
    constantTimeStringEquals(candidate.executionId, bootstrap.executionId) &&
    constantTimeStringEquals(candidate.nodeId, bootstrap.nodeId) &&
    constantTimeStringEquals(
      runnerControl.protocolToken,
      bootstrap.runnerControl.protocolToken,
    )
  );
}

export function selectMatchingAgentExecution(
  executions: CloudRunExecution[],
  bootstrap: AgentBootstrap,
  minimumCreateTime: number,
): CloudRunExecution | undefined {
  return executions
    .filter(
      (candidate) =>
        executionCreateTime(candidate) >= minimumCreateTime &&
        executionMatchesBootstrap(candidate, bootstrap),
    )
    .sort(
      (left, right) => executionCreateTime(right) - executionCreateTime(left),
    )[0];
}

async function waitForStartedAgentExecution(args: {
  accessToken: string;
  bootstrap: AgentBootstrap;
  jobPath: string;
  publishLog: AgentExecutionRequest['publishLog'];
  requestedAt: number;
}): Promise<string> {
  const startedAt = Date.now();
  const minimumCreateTime = args.requestedAt - 5000;
  while (Date.now() - startedAt < EXECUTION_START_TIMEOUT_MS) {
    const response = await cloudRunRequest<CloudRunExecutionsList>(
      `${args.jobPath}/executions`,
      args.accessToken,
    );
    const execution = selectMatchingAgentExecution(
      response.executions || [],
      args.bootstrap,
      minimumCreateTime,
    );
    if (execution?.name) {
      await args.publishLog(
        `AI Container Cloud Run Execution ${execution.name} started.`,
        'info',
      );
      return execution.name;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `Timed out reconciling the AI Container Cloud Run execution for ${args.jobPath}. The run request had an ambiguous outcome and was not repeated.`,
  );
}

function isAmbiguousRunFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  const match = error.message.match(/Cloud Run API returned (\d+):/);
  if (!match) return true;
  return [408, 429, 500, 502, 503, 504].includes(Number(match[1]));
}

async function startAgentJob(args: {
  createBootstrap: () => Promise<AgentBootstrap>;
  publishLog: AgentExecutionRequest['publishLog'];
  settings: GcpAgentRunSettings;
}): Promise<string> {
  const preparedJob = await withAgentJobConfigurationLock(() =>
    ensureAgentJob(args.settings, args.publishLog),
  );
  await args.publishLog(
    `Starting AI Container Cloud Run Job ${args.settings.jobName}.`,
    'info',
  );
  // Mint only after static job reconciliation, immediately before :run. This
  // keeps the short-lived control token fresh even when upstream workflow
  // nodes took a long time.
  const bootstrap = await args.createBootstrap();
  const requestedAt = Date.now();
  let operation: CloudRunOperation;
  try {
    operation = await cloudRunRequest<CloudRunOperation>(
      `${preparedJob.jobPath}:run`,
      args.settings.accessToken,
      {
        body: JSON.stringify(
          createAgentCloudRunRunBody(bootstrap, preparedJob.etag),
        ),
        method: 'POST',
      },
      // Retrying an ambiguously accepted :run call can create two executions.
      // Reconcile against the job's execution list instead.
      { maxTransientRetries: 0 },
    );
  } catch (error) {
    if (!isAmbiguousRunFailure(error)) throw error;
    await args.publishLog(
      'Cloud Run returned an ambiguous response while starting the AI Container; reconciling without repeating the run request.',
      'warn',
    );
    return waitForStartedAgentExecution({
      accessToken: args.settings.accessToken,
      bootstrap,
      jobPath: preparedJob.jobPath,
      publishLog: args.publishLog,
      requestedAt,
    });
  }
  const executionName = getExecutionNameFromOperation(operation);
  return (
    executionName ||
    waitForStartedAgentExecution({
      accessToken: args.settings.accessToken,
      bootstrap,
      jobPath: preparedJob.jobPath,
      publishLog: args.publishLog,
      requestedAt,
    })
  );
}

async function waitForAgentExecution(
  executionName: string,
  accessToken: string,
  onTerminal?: () => void,
  signal?: AbortSignal,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < EXECUTION_COMPLETION_TIMEOUT_MS) {
    signal?.throwIfAborted();
    let execution: CloudRunExecution;
    try {
      execution = await cloudRunRequest<CloudRunExecution>(
        executionName,
        accessToken,
        { signal },
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('Cloud Run API returned 404')
      ) {
        await sleep(POLL_INTERVAL_MS, signal);
        continue;
      }
      throw error;
    }
    const completed = execution.conditions?.find(
      (condition) => condition.type === 'Completed',
    );
    if (completed?.state === 'CONDITION_SUCCEEDED') {
      onTerminal?.();
      return;
    }
    if (completed?.state === 'CONDITION_FAILED') {
      onTerminal?.();
      throw new Error(
        `AI Container Cloud Run Execution ${execution.name || executionName} failed.`,
      );
    }
    await sleep(POLL_INTERVAL_MS, signal);
  }
  throw new Error(
    `Timed out waiting for AI Container Cloud Run Execution ${executionName}.`,
  );
}

export async function waitForRunnerReadyOrExecutionFailure(args: {
  accessToken: string;
  executionName: string;
  onExecutionTerminal: () => void;
  waitUntilRunnerReady: () => Promise<void>;
}): Promise<void> {
  const controller = new AbortController();
  const executionMonitor = waitForAgentExecution(
    args.executionName,
    args.accessToken,
    args.onExecutionTerminal,
    controller.signal,
  ).then(() => 'completed' as const);
  let state: 'completed' | 'ready';
  try {
    state = await Promise.race([
      args.waitUntilRunnerReady().then(() => 'ready' as const),
      executionMonitor,
    ]);
  } finally {
    controller.abort(new Error('AI Container runner reported ready.'));
    await executionMonitor.catch(() => {});
  }
  if (state === 'completed') {
    throw new Error(
      `AI Container Cloud Run Execution ${args.executionName} completed before the runner reported ready.`,
    );
  }
}

function agentTransportPayload(
  payload: ReturnType<typeof createAgentRunnerPayload>,
): Record<string, unknown> {
  const transported: Record<string, unknown> = { ...payload };
  // These two bootstrap credentials are delivered only in the short-lived
  // Cloud Run override and reconstructed by the runner after it receives the
  // signed payload.
  delete transported.gcpAccessToken;
  delete transported.runnerControl;
  return transported;
}

function assertTransportPayloadFits(
  payload: Record<string, unknown>,
  runnerControl: PubSubRunnerControl['payload'],
  executionId: string,
  nodeId: string,
): void {
  withRunnerProtocolSignature(
    {
      action: 'start',
      eventId: '00000000-0000-4000-8000-000000000000',
      executionId,
      nodeId,
      payload,
      prepareOnly: true,
      testId: executionId,
      timestamp: '2000-01-01T00:00:00.000Z',
      type: 'runner_control',
    },
    runnerControl.protocolToken,
  );
}

async function publishAgentCancelled(
  request: AgentExecutionRequest,
): Promise<void> {
  const timestamp = new Date().toISOString();
  await Promise.allSettled([
    request.publishEvent({
      level: 'warn',
      message: 'AI Container cancelled.',
      nodeId: request.nodeId,
      timestamp,
      type: 'log',
    }),
    request.publishEvent({
      nodeId: request.agent.nodeId,
      parentNodeId: request.nodeId,
      state: 'warning',
      timestamp,
      type: 'node_state',
    }),
    ...request.validators.map((validator) =>
      request.publishEvent({
        nodeId: validator.nodeId,
        parentNodeId: request.nodeId,
        state: 'warning',
        timestamp,
        type: 'node_state',
      }),
    ),
  ]);
}

export class GcpAgentExecutionBackend implements AgentExecutionBackend {
  supports(cloudProvider: string): boolean {
    return cloudProvider === 'GCP';
  }

  async prepare(request: AgentExecutionRequest): Promise<PreparedAgentRunner> {
    const settings = resolveGcpAgentRunSettings(request);
    settings.accessToken = await refreshGcpAccessTokenForAgent(
      request.reqBody.settings?.gcp || {},
    );
    const runnerControl = await createPubSubRunnerControl({
      accessToken: settings.accessToken,
      executionId: request.runtime.testId,
      nodeId: request.nodeId,
      onRunnerEvent: request.publishEvent,
      projectId: settings.projectId,
      runnerReadyTimeoutMs: AGENT_READY_TIMEOUT_MS,
      topicName: settings.topicName,
    });
    let executionName: string;
    let transportPayload: Record<string, unknown>;
    try {
      await ensureAgentControlPubSubRole({
        accessToken: settings.accessToken,
        controlServiceAccount: settings.controlServiceAccount,
        resourceName: `projects/${settings.projectId}/topics/${settings.topicName}`,
        role: 'roles/pubsub.publisher',
      });
      await ensureAgentControlPubSubRole({
        accessToken: settings.accessToken,
        controlServiceAccount: settings.controlServiceAccount,
        resourceName: `projects/${settings.projectId}/subscriptions/${runnerControl.payload.controlSubscriptionName}`,
        role: 'roles/pubsub.subscriber',
      });
      const fullPayload = createAgentRunnerPayload(
        request,
        runnerControl.payload,
      );
      fullPayload.config = {
        ...fullPayload.config,
        maxDurationMinutes: settings.maxDurationMinutes,
      };
      transportPayload = agentTransportPayload(fullPayload);
      assertTransportPayloadFits(
        transportPayload,
        runnerControl.payload,
        request.runtime.testId,
        request.nodeId,
      );
      executionName = await startAgentJob({
        createBootstrap: async () => ({
          executionId: request.runtime.testId,
          gcpAccessToken: await mintAgentControlAccessToken(settings),
          nodeId: request.nodeId,
          runnerControl: runnerControl.payload,
        }),
        publishLog: request.publishLog,
        settings,
      });
    } catch (error) {
      await runnerControl.cleanup();
      throw error;
    }

    let ready = false;
    let executionTerminal = false;
    const cancellation = createDurableCloudRunCancellation({
      cleanupControl: runnerControl.cleanup,
      isCompleted: () => executionTerminal,
      onSignalFailure: async (error) => {
        await request.publishLog(
          `Could not publish the AI Container cancellation signal: ${error instanceof Error ? error.message : String(error)}`,
          'warn',
        );
      },
      publishCancel: runnerControl.publishCancel,
      requestExecutionCancel: () =>
        cloudRunRequest<CloudRunOperation>(
          `${executionName}:cancel`,
          settings.accessToken,
          { body: '{}', method: 'POST' },
        ),
    });

    return {
      cancel: async () => {
        await publishAgentCancelled(request);
        await cancellation.cancel();
      },
      cleanup: cancellation.cleanup,
      start: async () => {
        await request.publishLog(
          `Starting AI Container with ${request.agent.nodeType} and ${request.validators.length} validator${request.validators.length === 1 ? '' : 's'}.`,
          'build',
        );
        await runnerControl.startWithRetry();
      },
      waitForCompletion: async (): Promise<AgentExecutionResult> => {
        await waitForAgentExecution(executionName, settings.accessToken, () => {
          executionTerminal = true;
        });
        const result = validateAgentExecutionResult(
          await runnerControl.waitForCompletion(),
        );
        await request.publishLog(
          `AI Container Cloud Run Job (${executionName}) finished.`,
          result.outcome === 'success' ? 'info' : 'warn',
        );
        return result;
      },
      waitUntilReady: async () => {
        if (ready) return;
        await waitForRunnerReadyOrExecutionFailure({
          accessToken: settings.accessToken,
          executionName,
          onExecutionTerminal: () => {
            executionTerminal = true;
          },
          waitUntilRunnerReady: () =>
            runnerControl.waitUntilReadyWithPayload(transportPayload),
        });
        ready = true;
      },
    };
  }
}
