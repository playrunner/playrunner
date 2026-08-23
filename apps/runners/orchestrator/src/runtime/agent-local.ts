import type {
  AgentExecutionBackend,
  AgentExecutionRequest,
  AgentExecutionResult,
  CiChangeContext,
  PreparedAgentRunner,
} from './contracts';
import { assertBoundedExecutionEnvironment } from '../../../shared/execution-environment';
import {
  createLocalContainerName,
  prepareLocalDockerRunner,
  resolveDockerPubSubEmulatorHost,
} from './docker-local';
import {
  createPubSubRunnerControl,
  type PubSubRunnerControl,
} from './pubsub-runner-control';

const AGENT_IMAGE = process.env.AGENT_IMAGE || 'playrunner-agent-runner:latest';
const MAX_AGENT_RESULT_BYTES = 8 * 1024 * 1024;
export const MAX_AGENT_PAYLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_AGENT_CPUS = new Set([1, 2, 4, 8]);
const ALLOWED_AGENT_MEMORY_GB = new Set([2, 4, 8, 16, 32]);
const AGENT_TERMINAL_GRACE_MS = 70_000;

export interface AgentRunnerPayload {
  agent: AgentExecutionRequest['agent'];
  changeContext?: AgentExecutionRequest['changeContext'];
  config: AgentExecutionRequest['config'];
  environment: Record<string, string>;
  gcpAccessToken?: string;
  github?: Record<string, unknown>;
  memory?: AgentExecutionRequest['memory'];
  nodeOutputs: AgentExecutionRequest['nodeOutputs'];
  requirements?: AgentExecutionRequest['requirements'];
  runnerControl: PubSubRunnerControl['payload'];
  runtime: AgentExecutionRequest['runtime'];
  validators: AgentExecutionRequest['validators'];
}

export interface LocalAgentDockerInvocation {
  args: string[];
  containerName: string;
  environment: NodeJS.ProcessEnv;
  payload: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function isCommitSha(value: unknown): value is string {
  return (
    typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)
  );
}

function isRepositoryPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    Buffer.byteLength(value, 'utf8') <= 4096 &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    !value.split('/').some((part) => part === '..' || part === '.git')
  );
}

function isGitHubRepository(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)
  );
}

function isSafeGitRef(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/.test(value) &&
    !value.includes('..') &&
    !value.includes('//') &&
    !value.includes('@{') &&
    !value.endsWith('/') &&
    !value.endsWith('.') &&
    !value.endsWith('.lock')
  );
}

function isPullRequestMetadata(
  value: unknown,
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const number = Number(value.number);
  if (
    !hasOnlyKeys(value, [
      'baseRef',
      'draft',
      'headRef',
      'number',
      'title',
      'url',
    ]) ||
    !isSafeGitRef(value.baseRef) ||
    value.draft !== true ||
    !isSafeGitRef(value.headRef) ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    typeof value.title !== 'string' ||
    !value.title.trim() ||
    value.title.length > 512 ||
    typeof value.url !== 'string'
  ) {
    return false;
  }
  try {
    const url = new URL(value.url);
    return (
      url.origin === 'https://github.com' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname.endsWith(`/pull/${number}`)
    );
  } catch {
    return false;
  }
}

function isBotDelivery(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !isCommitSha(value.developerHeadSha)) return false;
  if (
    !Array.isArray(value.changedFiles) ||
    value.changedFiles.length > 100 ||
    !value.changedFiles.every(isRepositoryPath) ||
    !Array.isArray(value.generatedTestFiles) ||
    value.generatedTestFiles.length > 100 ||
    !value.generatedTestFiles.every(isRepositoryPath)
  ) {
    return false;
  }
  if (value.status === 'no_changes') {
    return (
      hasOnlyKeys(value, [
        'changedFiles',
        'developerHeadSha',
        'generatedTestFiles',
        'status',
      ]) &&
      value.changedFiles.length === 0 &&
      value.generatedTestFiles.length === 0
    );
  }
  return (
    (value.status === 'created' || value.status === 'existing') &&
    hasOnlyKeys(value, [
      'branchName',
      'changedFiles',
      'commitSha',
      'developerHeadSha',
      'generatedTestFiles',
      'pullRequest',
      'status',
    ]) &&
    isSafeGitRef(value.branchName) &&
    isCommitSha(value.commitSha) &&
    isPullRequestMetadata(value.pullRequest) &&
    value.pullRequest.headRef === value.branchName
  );
}

function isAgentMemory(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  let bytes: number;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return false;
  }
  if (
    bytes > 64 * 1024 ||
    !hasOnlyKeys(value, [
      'botPullRequest',
      'coverageGaps',
      'generatedTestFiles',
      'lastProcessedHeadSha',
      'repository',
      'schemaVersion',
      'validation',
    ]) ||
    value.schemaVersion !== '1.0' ||
    !isGitHubRepository(value.repository) ||
    !isCommitSha(value.lastProcessedHeadSha) ||
    !Array.isArray(value.generatedTestFiles) ||
    value.generatedTestFiles.length > 100 ||
    !value.generatedTestFiles.every(isRepositoryPath) ||
    !Array.isArray(value.coverageGaps) ||
    value.coverageGaps.length > 100 ||
    !isRecord(value.validation) ||
    !hasOnlyKeys(value.validation, ['status', 'summary']) ||
    (value.validation.status !== 'passed' &&
      value.validation.status !== 'failed') ||
    typeof value.validation.summary !== 'string' ||
    !value.validation.summary.trim() ||
    value.validation.summary.length > 4096
  ) {
    return false;
  }
  const rangesValid = value.coverageGaps.every((entry) => {
    if (
      !isRecord(entry) ||
      !hasOnlyKeys(entry, ['changedLines', 'path', 'reason']) ||
      !isRepositoryPath(entry.path) ||
      typeof entry.reason !== 'string' ||
      !entry.reason.trim() ||
      entry.reason.length > 4096 ||
      !Array.isArray(entry.changedLines) ||
      entry.changedLines.length > 500
    ) {
      return false;
    }
    return entry.changedLines.every(
      (range) =>
        isRecord(range) &&
        hasOnlyKeys(range, ['end', 'start']) &&
        Number.isSafeInteger(range.start) &&
        Number.isSafeInteger(range.end) &&
        Number(range.start) >= 1 &&
        Number(range.end) >= Number(range.start),
    );
  });
  if (!rangesValid) return false;
  if (value.botPullRequest === undefined) return true;
  const pullRequest = value.botPullRequest;
  return (
    isRecord(pullRequest) &&
    hasOnlyKeys(pullRequest, ['headRef', 'headSha', 'number', 'url']) &&
    isSafeGitRef(pullRequest.headRef) &&
    isCommitSha(pullRequest.headSha) &&
    Number.isSafeInteger(pullRequest.number) &&
    Number(pullRequest.number) > 0 &&
    typeof pullRequest.url === 'string' &&
    pullRequest.url.startsWith('https://github.com/')
  );
}

export function validateAgentExecutionResult(
  result: AgentExecutionResult,
): AgentExecutionResult {
  if (!isRecord(result) || !isRecord(result.output)) {
    throw new Error('AI Container result schema is invalid.');
  }
  const output = result.output;
  const attemptHistory = output.attemptHistory;
  const attempts = Number(output.attempts);
  const patch = output.patch;
  const patchBytes = Number(output.patchBytes);
  if (
    (result.outcome !== 'success' && result.outcome !== 'error') ||
    (output.status !== 'passed' && output.status !== 'failed') ||
    typeof output.attempts !== 'number' ||
    !Number.isInteger(attempts) ||
    attempts < 0 ||
    attempts > 10 ||
    !Array.isArray(attemptHistory) ||
    attemptHistory.length !== attempts ||
    !attemptHistory.every(
      (attempt, index) =>
        isRecord(attempt) &&
        typeof attempt.attempt === 'number' &&
        attempt.attempt === index + 1,
    ) ||
    typeof output.stopReason !== 'string' ||
    !output.stopReason.trim() ||
    typeof patch !== 'string' ||
    typeof output.patchBytes !== 'number' ||
    !Number.isInteger(patchBytes) ||
    patchBytes < Buffer.byteLength(patch, 'utf8') ||
    typeof output.patchTruncated !== 'boolean' ||
    (!output.patchTruncated &&
      patchBytes !== Buffer.byteLength(patch, 'utf8')) ||
    typeof output.repositoryStatus !== 'string' ||
    !Object.hasOwn(output, 'validation') ||
    (output.validation !== null && !isRecord(output.validation))
  ) {
    throw new Error('AI Container result schema is invalid.');
  }
  if (
    (output.botDelivery !== undefined && !isBotDelivery(output.botDelivery)) ||
    (output.memory !== undefined && !isAgentMemory(output.memory)) ||
    (output.deliveryError !== undefined &&
      (typeof output.deliveryError !== 'string' ||
        !output.deliveryError.trim() ||
        output.deliveryError.length > 4096))
  ) {
    throw new Error('AI Container delivery or memory schema is invalid.');
  }
  if (isRecord(output.botDelivery)) {
    const delivery = output.botDelivery;
    if (delivery.status === 'no_changes') {
      if (output.botPullRequest !== undefined) {
        throw new Error('AI Container bot PR result schema is invalid.');
      }
    } else {
      const pullRequest = delivery.pullRequest as Record<string, unknown>;
      const expected = {
        ...pullRequest,
        branchName: delivery.branchName,
        commitSha: delivery.commitSha,
        status: delivery.status,
      };
      const actual = output.botPullRequest;
      if (
        !isRecord(actual) ||
        !hasOnlyKeys(actual, Object.keys(expected)) ||
        Object.entries(expected).some(([key, value]) => actual[key] !== value)
      ) {
        throw new Error('AI Container bot PR result schema is invalid.');
      }
    }
  } else if (output.botPullRequest !== undefined) {
    throw new Error('AI Container bot PR result schema is invalid.');
  }
  if (output.status === 'passed' && output.deliveryError !== undefined) {
    throw new Error(
      'Successful AI Container result contains a delivery error.',
    );
  }
  if (output.status === 'passed') {
    if (
      result.outcome !== 'success' ||
      output.stopReason !== 'passed' ||
      !isRecord(output.validation) ||
      output.validation.passed !== true ||
      output.validation.status !== 'passed' ||
      !isRecord(output.artifacts) ||
      typeof output.artifacts.validationHistory !== 'string' ||
      typeof output.artifacts.patch !== 'string' ||
      typeof output.artifacts.repositoryStatus !== 'string' ||
      output.artifactError !== undefined ||
      output.repositoryError !== undefined
    ) {
      throw new Error('Successful AI Container result schema is invalid.');
    }
  } else if (output.stopReason === 'passed' || result.outcome !== 'error') {
    throw new Error('Failed AI Container result schema is invalid.');
  }
  const resultBytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
  if (resultBytes > MAX_AGENT_RESULT_BYTES) {
    throw new Error('AI Container result is too large.');
  }
  return result;
}

export type BotPullRequestWorkflowEvent = {
  baseRef: string;
  draft: true;
  headRef: string;
  number: number;
  repository: string;
  status: 'created' | 'existing';
  type: 'bot_pull_request';
  url: string;
};

export function createBotPullRequestWorkflowEvent(
  result: AgentExecutionResult,
  changeContext?: CiChangeContext,
): BotPullRequestWorkflowEvent | null {
  if (!isRecord(result) || !isRecord(result.output.botDelivery)) return null;
  const output = validateAgentExecutionResult(result).output;
  const delivery = output.botDelivery;
  if (!isBotDelivery(delivery)) {
    throw new Error('AI Container bot PR result schema is invalid.');
  }
  if (delivery.status === 'no_changes') return null;
  if (!changeContext) {
    throw new Error(
      'AI Container bot PR result requires an immutable CI change context.',
    );
  }
  const pullRequest = delivery.pullRequest as Record<string, unknown>;
  const status = delivery.status;
  const number = Number(pullRequest.number);
  const repository = changeContext.repository.toLowerCase();
  let url: URL;
  try {
    url = new URL(String(pullRequest.url));
  } catch {
    throw new Error('AI Container bot PR URL is invalid.');
  }
  if (
    (status !== 'created' && status !== 'existing') ||
    !isGitHubRepository(repository) ||
    Buffer.byteLength(repository, 'utf8') > 200 ||
    delivery.developerHeadSha !== changeContext.headSha.toLowerCase() ||
    pullRequest.baseRef !== changeContext.headRef ||
    pullRequest.draft !== true ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    number > 2_147_483_647 ||
    url.origin !== 'https://github.com' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.toLowerCase() !== `/${repository}/pull/${number}`
  ) {
    throw new Error(
      'AI Container bot PR result does not match the immutable CI source, head, or draft delivery contract.',
    );
  }
  return {
    baseRef: changeContext.headRef,
    draft: true,
    headRef: String(pullRequest.headRef),
    number,
    repository,
    status,
    type: 'bot_pull_request',
    url: `https://github.com/${repository}/pull/${number}`,
  };
}

function containerName(request: AgentExecutionRequest) {
  return createLocalContainerName(
    'playrunner-agent',
    request.runtime.testId,
    request.nodeId,
  );
}

export function serializeAgentPayload(payload: AgentRunnerPayload): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    throw new Error('AI Container payload could not be serialized.');
  }

  const payloadBytes = Buffer.byteLength(serialized, 'utf8');
  if (payloadBytes > MAX_AGENT_PAYLOAD_BYTES) {
    throw new Error(
      `AI Container payload is ${payloadBytes} bytes; maximum inline payload size is ${MAX_AGENT_PAYLOAD_BYTES} bytes. Materialize large workflow inputs as artifacts instead.`,
    );
  }

  return serialized;
}

function assertEnvironmentKey(key: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(`Invalid AI Container Environment variable name: ${key}`);
  }
  if (
    /^(?:CODEX_HOME|DOCKER_.+|HOME|NODE_OPTIONS|PATH|PAYLOAD|PLAYRUNNER_.+)$/i.test(
      key,
    )
  ) {
    throw new Error(`Reserved AI Container Environment variable name: ${key}`);
  }
}

export function createLocalAgentDockerInvocation(
  request: AgentExecutionRequest,
  runnerControl: PubSubRunnerControl['payload'],
): LocalAgentDockerInvocation {
  const name = containerName(request);
  const payload = serializeAgentPayload(
    createAgentRunnerPayload(request, runnerControl),
  );
  const environment: NodeJS.ProcessEnv = { ...process.env };
  const configuredCpu = Number(request.config.cpu);
  const cpu = ALLOWED_AGENT_CPUS.has(configuredCpu) ? configuredCpu : 4;
  const configuredMemory = Number(request.config.memory);
  const memory = ALLOWED_AGENT_MEMORY_GB.has(configuredMemory)
    ? configuredMemory
    : 8;
  const args = [
    'run',
    '-i',
    '--init',
    '--rm',
    '--pids-limit',
    '512',
    '--cap-drop',
    'ALL',
    '--cap-add',
    'CHOWN',
    '--cap-add',
    'DAC_OVERRIDE',
    '--cap-add',
    'SETGID',
    '--cap-add',
    'SETUID',
    '--security-opt',
    'no-new-privileges',
    '--ulimit',
    'nofile=4096:4096',
    '--name',
    name,
    '--label',
    `playrunner.execution-id=${request.runtime.testId || ''}`,
    '--label',
    `playrunner.node-id=${request.nodeId}`,
    '--cpus',
    String(cpu),
    '--memory',
    `${memory}g`,
    '--shm-size',
    '1g',
    '--platform',
    'linux/amd64',
    '--add-host',
    'host.docker.internal:host-gateway',
  ];
  const emulatorHost = resolveDockerPubSubEmulatorHost(
    process.env.PUBSUB_EMULATOR_HOST,
  );
  if (emulatorHost) {
    args.push('-e', `PUBSUB_EMULATOR_HOST=${emulatorHost}`);
  }
  args.push(AGENT_IMAGE);

  return {
    args,
    containerName: name,
    environment,
    payload,
  };
}

export function createAgentRunnerPayload(
  request: AgentExecutionRequest,
  runnerControl: PubSubRunnerControl['payload'],
): AgentRunnerPayload {
  const selectedEnvironment: Record<string, string> = {};
  for (const key of new Set(request.envKeys)) {
    assertEnvironmentKey(key);
    selectedEnvironment[key] = request.globalEnvVars[key] ?? '';
  }
  assertBoundedExecutionEnvironment(
    selectedEnvironment,
    'AI Container Environment',
  );
  return {
    agent: request.agent,
    ...(request.changeContext ? { changeContext: request.changeContext } : {}),
    config: request.config,
    environment: selectedEnvironment,
    ...(request.reqBody.settings?.gcp?.accessToken
      ? { gcpAccessToken: String(request.reqBody.settings.gcp.accessToken) }
      : {}),
    github: request.reqBody.settings?.github,
    ...(request.memory ? { memory: request.memory } : {}),
    nodeOutputs: request.nodeOutputs,
    ...(request.requirements?.length
      ? { requirements: request.requirements }
      : {}),
    runnerControl,
    runtime: request.runtime,
    validators: request.validators,
  };
}

export class LocalAgentExecutionBackend implements AgentExecutionBackend {
  supports(cloudProvider: string): boolean {
    return cloudProvider === 'LOCAL_RUNNER';
  }

  async prepare(request: AgentExecutionRequest): Promise<PreparedAgentRunner> {
    const eventTransport = request.reqBody.eventTransport as
      | { projectId?: string; topicName?: string; type?: 'gcp_pubsub' }
      | undefined;
    if (
      eventTransport?.type !== 'gcp_pubsub' ||
      !eventTransport.projectId ||
      !eventTransport.topicName
    ) {
      throw new Error('Local AI Container requires Pub/Sub transport.');
    }
    const accessToken = request.reqBody.settings?.gcp?.accessToken as
      string | undefined;
    const runnerControl = await createPubSubRunnerControl({
      accessToken,
      executionId: request.runtime.testId,
      nodeId: request.nodeId,
      onRunnerEvent: request.publishEvent,
      projectId: eventTransport.projectId,
      topicName: eventTransport.topicName,
    });
    let runner: PreparedAgentRunner;
    try {
      const invocation = createLocalAgentDockerInvocation(
        request,
        runnerControl.payload,
      );
      await request.publishLog(
        `Preparing AI Container in Docker: ${AGENT_IMAGE}`,
        'build',
      );
      runner = await prepareLocalDockerRunner<AgentExecutionResult>({
        args: invocation.args,
        containerName: invocation.containerName,
        control: runnerControl,
        environment: invocation.environment,
        executionTimeoutMs:
          (Number.isInteger(Number(request.config.maxDurationMinutes)) &&
          Number(request.config.maxDurationMinutes) >= 1 &&
          Number(request.config.maxDurationMinutes) <= 1440
            ? Number(request.config.maxDurationMinutes)
            : 60) *
            60_000 +
          AGENT_TERMINAL_GRACE_MS,
        input: invocation.payload,
        label: `AI Container ${request.nodeId}`,
        nodeId: request.nodeId,
        publishLog: request.publishLog,
        registerActiveProcess: request.registerActiveProcess,
        stderrLevel: 'warn',
      });
    } catch (error) {
      await runnerControl.cleanup();
      throw error;
    }

    return {
      ...runner,
      cancel: async () => {
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
        await runner.cancel?.();
      },
      start: async () => {
        await request.publishLog(
          `Starting AI Container with ${request.agent.nodeType} and ${request.validators.length} validator${request.validators.length === 1 ? '' : 's'}.`,
          'build',
        );
        await runner.start();
      },
      waitForCompletion: async () =>
        validateAgentExecutionResult(await runner.waitForCompletion()),
    };
  }
}
