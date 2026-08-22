import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { assertBoundedExecutionEnvironment } from '../../shared/execution-environment';
import {
  DEFAULT_COVERAGE_SUMMARY_PATHS,
  DEFAULT_FAIL_ON,
  DEFAULT_MINIMUMS,
  type ValidatorConfig,
} from './validator';
import type { ChangeManifest, ChangedLineRange } from './repository';
import type { RunnerControlConfig } from '../../shared/runner-control';
import { isRunnerProtocolToken } from '../../shared/runner-protocol';

export const MAX_AGENT_PAYLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_AGENT_MEMORY_BYTES = 64 * 1024;
export const AGENT_MEMORY_SCHEMA_VERSION = '1.0' as const;
const MAX_EXTERNAL_REQUIREMENTS = 20;
const MAX_REQUIREMENT_TEXT_BYTES = 64 * 1024;

export type CiChangeContext = {
  baseRef: string;
  baseSha: string;
  eventType: 'manual' | 'pull_request' | 'push';
  headRef: string;
  headSha: string;
  pullRequestNumber?: number;
  repository: string;
};

export type AgentStructuredMemory = {
  botPullRequest?: {
    headRef: string;
    headSha: string;
    number: number;
    url: string;
  };
  coverageGaps: Array<{
    changedLines: ChangedLineRange[];
    path: string;
    reason: string;
  }>;
  generatedTestFiles: string[];
  lastProcessedHeadSha: string;
  repository: string;
  schemaVersion: typeof AGENT_MEMORY_SCHEMA_VERSION;
  validation: {
    status: 'failed' | 'passed';
    summary: string;
  };
};

export type AgentRunnerPayload = {
  agent: {
    config?: Record<string, unknown>;
    nodeId: string;
    nodeType: string;
  };
  changeContext?: CiChangeContext;
  config: Record<string, unknown>;
  environment: Record<string, string>;
  gcpAccessToken?: string;
  github?: { accessToken?: string };
  memory?: AgentStructuredMemory;
  nodeOutputs?: Readonly<Record<string, unknown>>;
  requirements?: Array<{
    body: string;
    id: string;
    source: 'github' | 'jira' | 'workflow';
    title: string;
    url?: string;
  }>;
  runnerControl: RunnerControlConfig;
  runtime: {
    bucketName?: string;
    cloudProvider: string;
    editorApiUrl: string;
    executionAuthToken: string;
    nodeId: string;
    testId: string;
    workflowId: string;
  };
  validators: Array<{
    config?: Record<string, unknown>;
    nodeId: string;
    nodeType: string;
  }>;
};

export type MaterializedAgentContext = {
  changeManifestPath?: string;
  memoryPath?: string;
  nodeOutputsPath: string;
  requirementsPath?: string;
  repositoriesPath?: string;
};

const CHANGE_CONTEXT_KEYS = new Set([
  'baseRef',
  'baseSha',
  'eventType',
  'headRef',
  'headSha',
  'pullRequestNumber',
  'repository',
]);
const MEMORY_KEYS = new Set([
  'botPullRequest',
  'coverageGaps',
  'generatedTestFiles',
  'lastProcessedHeadSha',
  'repository',
  'schemaVersion',
  'validation',
]);
const MAX_MEMORY_FILES = 1_000;
const MAX_MEMORY_GAPS = 500;
const MAX_MEMORY_LINE_RANGES = 10_000;
const MAX_MEMORY_TEXT_LENGTH = 4_096;
const MAX_REPOSITORY_PATH_BYTES = 4_096;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  field: string,
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) {
    throw new Error(`AI Container ${field}.${unexpected} is not supported.`);
  }
}

export function normalizeGitHubRepository(
  value: unknown,
  field = 'config.repository',
): string {
  const repository = String(value || '')
    .trim()
    .replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error(
      `AI Container ${field} must be a GitHub repository in owner/repository form.`,
    );
  }
  return repository;
}

function normalizeCiRepository(value: unknown): string {
  const repository = normalizeGitHubRepository(
    value,
    'changeContext.repository',
  );
  const segments = repository.split('/');
  if (
    Buffer.byteLength(repository, 'utf8') > 200 ||
    segments.some(
      (segment) =>
        segment.length > 100 ||
        !/^[A-Za-z0-9]/.test(segment) ||
        segment.endsWith('-'),
    )
  ) {
    throw new Error(
      'AI Container changeContext.repository contains an unsafe owner or repository name.',
    );
  }
  return repository;
}

function requiredCommitSha(value: unknown, field: string): string {
  const sha = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha)) {
    throw new Error(`AI Container ${field} must be a complete commit SHA.`);
  }
  return sha;
}

function requiredGitRef(value: unknown, field: string): string {
  const ref = typeof value === 'string' ? value.trim() : '';
  const components = ref.split('/');
  const hasForbiddenCharacter = Array.from(ref).some((character) => {
    const code = character.charCodeAt(0);
    return (
      code <= 32 ||
      code === 127 ||
      ['~', '^', ':', '?', '*', '[', '\\'].includes(character)
    );
  });
  if (
    !ref ||
    ref.length > 255 ||
    ref === '@' ||
    ref === 'HEAD' ||
    ref.startsWith('/') ||
    ref.startsWith('refs/') ||
    ref.endsWith('/') ||
    ref.endsWith('.') ||
    ref.endsWith('.lock') ||
    ref.includes('..') ||
    ref.includes('//') ||
    ref.includes('@{') ||
    components.some(
      (component) =>
        !component ||
        component.startsWith('.') ||
        component.endsWith('.') ||
        component.endsWith('.lock'),
    ) ||
    hasForbiddenCharacter
  ) {
    throw new Error(`AI Container ${field} must be a safe branch name.`);
  }
  return ref;
}

function isSafeRepositoryPath(value: string): boolean {
  const hasControlCharacter = Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  return (
    Boolean(value) &&
    Buffer.byteLength(value, 'utf8') <= MAX_REPOSITORY_PATH_BYTES &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !value.includes('\uFFFD') &&
    !hasControlCharacter &&
    path.posix.normalize(value) === value &&
    value !== '.' &&
    !value
      .split('/')
      .some((segment) => segment === '..' || segment.toLowerCase() === '.git')
  );
}

function requiredRepositoryPath(value: unknown, field: string): string {
  const repositoryPath = typeof value === 'string' ? value : '';
  if (!isSafeRepositoryPath(repositoryPath)) {
    throw new Error(`AI Container ${field} must be a safe repository path.`);
  }
  return repositoryPath;
}

function requiredBoundedText(
  value: unknown,
  field: string,
  maximumLength = MAX_MEMORY_TEXT_LENGTH,
): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > maximumLength || text.includes('\0')) {
    throw new Error(`AI Container ${field} is missing or too large.`);
  }
  return text;
}

function normalizeRequirements(
  value: unknown,
): NonNullable<AgentRunnerPayload['requirements']> {
  if (!Array.isArray(value) || value.length > MAX_EXTERNAL_REQUIREMENTS) {
    throw new Error(
      `AI Container requirements must contain at most ${MAX_EXTERNAL_REQUIREMENTS} entries.`,
    );
  }
  return value.map((candidate, index) => {
    const requirement = record(candidate);
    assertOnlyKeys(
      requirement,
      new Set(['body', 'id', 'source', 'title', 'url']),
      `requirements[${index}]`,
    );
    if (
      requirement.source !== 'github' &&
      requirement.source !== 'jira' &&
      requirement.source !== 'workflow'
    ) {
      throw new Error(
        `AI Container requirements[${index}].source is unsupported.`,
      );
    }
    const body = typeof requirement.body === 'string' ? requirement.body : '';
    if (Buffer.byteLength(body, 'utf8') > MAX_REQUIREMENT_TEXT_BYTES) {
      throw new Error(`AI Container requirements[${index}].body is too large.`);
    }
    const url = typeof requirement.url === 'string' ? requirement.url.trim() : '';
    if (url) {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        throw new Error(`AI Container requirements[${index}].url is invalid.`);
      }
      if (
        url.length > 2_048 ||
        (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:')
      ) {
        throw new Error(`AI Container requirements[${index}].url is invalid.`);
      }
    }
    return {
      body,
      id: requiredBoundedText(requirement.id, `requirements[${index}].id`, 256),
      source: requirement.source,
      title: requiredBoundedText(
        requirement.title,
        `requirements[${index}].title`,
        1_024,
      ),
      ...(url ? { url } : {}),
    };
  });
}

function normalizeLineRanges(
  value: unknown,
  field: string,
): ChangedLineRange[] {
  if (!Array.isArray(value)) {
    throw new Error(`AI Container ${field} must be an array of line ranges.`);
  }
  const ranges = value.map((candidate, index) => {
    const range = record(candidate);
    assertOnlyKeys(range, new Set(['end', 'start']), `${field}[${index}]`);
    const start = range.start;
    const end = range.end;
    if (
      typeof start !== 'number' ||
      typeof end !== 'number' ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 1 ||
      end < start
    ) {
      throw new Error(
        `AI Container ${field}[${index}] must contain a valid inclusive line range.`,
      );
    }
    return { end, start };
  });
  ranges.sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const merged: ChangedLineRange[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + 1) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

export function normalizeCiChangeContext(value: unknown): CiChangeContext {
  const context = record(value);
  assertOnlyKeys(context, CHANGE_CONTEXT_KEYS, 'changeContext');
  const eventType = context.eventType;
  if (
    eventType !== 'push' &&
    eventType !== 'pull_request' &&
    eventType !== 'manual'
  ) {
    throw new Error(
      'AI Container changeContext.eventType must be push, pull_request, or manual.',
    );
  }
  let pullRequestNumber: number | undefined;
  if (context.pullRequestNumber !== undefined) {
    pullRequestNumber = context.pullRequestNumber as number;
    if (
      typeof pullRequestNumber !== 'number' ||
      !Number.isSafeInteger(pullRequestNumber) ||
      pullRequestNumber < 1 ||
      pullRequestNumber > 2_147_483_647
    ) {
      throw new Error(
        'AI Container changeContext.pullRequestNumber must be a positive integer.',
      );
    }
  }
  const baseSha = requiredCommitSha(context.baseSha, 'changeContext.baseSha');
  const headSha = requiredCommitSha(context.headSha, 'changeContext.headSha');
  if (baseSha === headSha) {
    throw new Error(
      'AI Container changeContext baseSha and headSha must identify different commits.',
    );
  }
  return {
    baseRef: requiredGitRef(context.baseRef, 'changeContext.baseRef'),
    baseSha,
    eventType,
    headRef: requiredGitRef(context.headRef, 'changeContext.headRef'),
    headSha,
    ...(pullRequestNumber ? { pullRequestNumber } : {}),
    repository: normalizeCiRepository(context.repository),
  };
}

function normalizeStructuredMemory(value: unknown): AgentStructuredMemory {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error('AI Container memory must be JSON serializable.');
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_AGENT_MEMORY_BYTES) {
    throw new Error(
      `AI Container memory exceeds ${MAX_AGENT_MEMORY_BYTES} bytes. Store compact structured outcomes, not transcripts.`,
    );
  }
  const memory = record(value);
  assertOnlyKeys(memory, MEMORY_KEYS, 'memory');
  if (memory.schemaVersion !== AGENT_MEMORY_SCHEMA_VERSION) {
    throw new Error(
      `AI Container memory.schemaVersion must be ${AGENT_MEMORY_SCHEMA_VERSION}.`,
    );
  }
  if (
    !Array.isArray(memory.generatedTestFiles) ||
    memory.generatedTestFiles.length > MAX_MEMORY_FILES
  ) {
    throw new Error(
      `AI Container memory.generatedTestFiles must contain at most ${MAX_MEMORY_FILES} paths.`,
    );
  }
  const generatedTestFiles = memory.generatedTestFiles.map((entry, index) =>
    requiredRepositoryPath(entry, `memory.generatedTestFiles[${index}]`),
  );
  if (new Set(generatedTestFiles).size !== generatedTestFiles.length) {
    throw new Error(
      'AI Container memory.generatedTestFiles must not contain duplicates.',
    );
  }
  if (
    !Array.isArray(memory.coverageGaps) ||
    memory.coverageGaps.length > MAX_MEMORY_GAPS
  ) {
    throw new Error(
      `AI Container memory.coverageGaps must contain at most ${MAX_MEMORY_GAPS} entries.`,
    );
  }
  let lineRangeCount = 0;
  const coverageGaps = memory.coverageGaps.map((entry, index) => {
    const gap = record(entry);
    assertOnlyKeys(
      gap,
      new Set(['changedLines', 'path', 'reason']),
      `memory.coverageGaps[${index}]`,
    );
    const changedLines = normalizeLineRanges(
      gap.changedLines,
      `memory.coverageGaps[${index}].changedLines`,
    );
    lineRangeCount += changedLines.length;
    return {
      changedLines,
      path: requiredRepositoryPath(
        gap.path,
        `memory.coverageGaps[${index}].path`,
      ),
      reason: requiredBoundedText(
        gap.reason,
        `memory.coverageGaps[${index}].reason`,
      ),
    };
  });
  if (lineRangeCount > MAX_MEMORY_LINE_RANGES) {
    throw new Error(
      `AI Container memory contains more than ${MAX_MEMORY_LINE_RANGES} changed line ranges.`,
    );
  }
  coverageGaps.sort((left, right) =>
    left.path < right.path
      ? -1
      : left.path > right.path
        ? 1
        : left.reason < right.reason
          ? -1
          : left.reason > right.reason
            ? 1
            : 0,
  );
  const validation = record(memory.validation);
  assertOnlyKeys(
    validation,
    new Set(['status', 'summary']),
    'memory.validation',
  );
  if (validation.status !== 'passed' && validation.status !== 'failed') {
    throw new Error(
      'AI Container memory.validation.status must be passed or failed.',
    );
  }
  let botPullRequest: AgentStructuredMemory['botPullRequest'];
  if (memory.botPullRequest !== undefined) {
    const pullRequest = record(memory.botPullRequest);
    assertOnlyKeys(
      pullRequest,
      new Set(['headRef', 'headSha', 'number', 'url']),
      'memory.botPullRequest',
    );
    const number = pullRequest.number;
    if (
      typeof number !== 'number' ||
      !Number.isSafeInteger(number) ||
      number < 1
    ) {
      throw new Error(
        'AI Container memory.botPullRequest.number must be a positive integer.',
      );
    }
    let url: URL;
    try {
      url = new URL(String(pullRequest.url || ''));
    } catch {
      throw new Error(
        'AI Container memory.botPullRequest.url must be a valid GitHub pull request URL.',
      );
    }
    if (
      url.origin !== 'https://github.com' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname.replace(/\/$/, '').toLowerCase() !==
        `/${normalizeGitHubRepository(memory.repository)}/pull/${number}`.toLowerCase()
    ) {
      throw new Error(
        'AI Container memory.botPullRequest.url must match its repository and pull request number.',
      );
    }
    botPullRequest = {
      headRef: requiredGitRef(
        pullRequest.headRef,
        'memory.botPullRequest.headRef',
      ),
      headSha: requiredCommitSha(
        pullRequest.headSha,
        'memory.botPullRequest.headSha',
      ),
      number,
      url: url.toString(),
    };
  }
  return {
    ...(botPullRequest ? { botPullRequest } : {}),
    coverageGaps,
    generatedTestFiles: [...generatedTestFiles].sort(),
    lastProcessedHeadSha: requiredCommitSha(
      memory.lastProcessedHeadSha,
      'memory.lastProcessedHeadSha',
    ),
    repository: normalizeGitHubRepository(
      memory.repository,
      'memory.repository',
    ),
    schemaVersion: AGENT_MEMORY_SCHEMA_VERSION,
    validation: {
      status: validation.status,
      summary: requiredBoundedText(
        validation.summary,
        'memory.validation.summary',
      ),
    },
  };
}

function isReservedEnvironmentKey(key: string): boolean {
  return /^(?:CODEX_HOME|DOCKER_.+|HOME|NODE_OPTIONS|PATH|PAYLOAD|PLAYRUNNER_.+)$/i.test(
    key,
  );
}

function requiredPubSubSegment(
  value: unknown,
  field: keyof RunnerControlConfig,
): string {
  const hasInvalidCharacter =
    typeof value === 'string' &&
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return (
        code <= 32 || code === 127 || character === '/' || character === '\\'
      );
    });
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 255 ||
    hasInvalidCharacter
  ) {
    throw new Error(`AI Container runnerControl.${field} is invalid.`);
  }
  return value.trim();
}

function requiredAttachmentId(value: unknown, field: string): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (
    !id ||
    id.length > 255 ||
    Array.from(id).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw new Error(`AI Container ${field} is missing or invalid.`);
  }
  return id;
}

function requiredRuntimeIdentifier(value: unknown, field: string): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(id)) {
    throw new Error(`AI Container runtime.${field} must be a safe identifier.`);
  }
  return id;
}

function requiredEditorApiOrigin(value: unknown): string {
  let url: URL;
  try {
    url = new URL(typeof value === 'string' ? value.trim() : '');
  } catch {
    throw new Error(
      'AI Container runtime.editorApiUrl must be a valid HTTP(S) origin.',
    );
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password
  ) {
    throw new Error(
      'AI Container runtime.editorApiUrl must be a credential-free HTTP(S) origin.',
    );
  }
  return url.origin;
}

async function readBoundedStream(input: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    bytes += buffer.length;
    if (bytes > MAX_AGENT_PAYLOAD_BYTES) {
      throw new Error(
        `AI Container payload exceeds ${MAX_AGENT_PAYLOAD_BYTES} bytes. Materialize large workflow inputs as artifacts instead.`,
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function readAgentPayload(
  input: Readable = process.stdin,
): Promise<AgentRunnerPayload> {
  const raw = await readBoundedStream(input);
  if (!raw.trim()) {
    throw new Error('AI Container payload is required on stdin.');
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_AGENT_PAYLOAD_BYTES) {
    throw new Error(
      `AI Container payload exceeds ${MAX_AGENT_PAYLOAD_BYTES} bytes. Materialize large workflow inputs as artifacts instead.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('AI Container payload is not valid JSON.');
  }
  return parseAgentPayload(parsed);
}

export function parseAgentPayload(value: unknown): AgentRunnerPayload {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error('AI Container payload is not JSON serializable.');
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_AGENT_PAYLOAD_BYTES) {
    throw new Error(
      `AI Container payload exceeds ${MAX_AGENT_PAYLOAD_BYTES} bytes. Materialize large workflow inputs as artifacts instead.`,
    );
  }
  const payload = record(value) as AgentRunnerPayload;
  const agent = record(payload.agent);
  if (typeof agent.nodeType !== 'string') {
    throw new Error('Connect one Agent to the AI Container.');
  }
  if (!Array.isArray(payload.validators) || !payload.validators.length) {
    throw new Error('Connect at least one Validator to the AI Container.');
  }
  payload.agent = {
    config: record(agent.config),
    nodeId: requiredAttachmentId(agent.nodeId, 'agent.nodeId'),
    nodeType: agent.nodeType,
  };
  payload.validators = payload.validators.map((value, index) => {
    const validator = record(value);
    if (typeof validator.nodeType !== 'string') {
      throw new Error(
        `AI Container validators[${index}].nodeType is required.`,
      );
    }
    return {
      config: record(validator.config),
      nodeId: requiredAttachmentId(
        validator.nodeId,
        `validators[${index}].nodeId`,
      ),
      nodeType: validator.nodeType,
    };
  });
  const attachmentIds = [
    payload.agent.nodeId,
    ...payload.validators.map((validator) => validator.nodeId),
  ];
  if (new Set(attachmentIds).size !== attachmentIds.length) {
    throw new Error('AI Container attachment node IDs must be unique.');
  }
  const runnerControl = record(payload.runnerControl);
  if (runnerControl.type !== 'gcp_pubsub') {
    throw new Error('AI Container runnerControl.type must be gcp_pubsub.');
  }
  const selectedEnvironment: Record<string, string> = {};
  for (const [key, value] of Object.entries(record(payload.environment))) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
      isReservedEnvironmentKey(key) ||
      typeof value !== 'string'
    ) {
      throw new Error(
        `Invalid or reserved AI Container Environment key: ${key}`,
      );
    }
    selectedEnvironment[key] = value;
  }
  assertBoundedExecutionEnvironment(
    selectedEnvironment,
    'AI Container Environment',
  );
  payload.config = record(payload.config);
  if (payload.changeContext !== undefined) {
    payload.changeContext = normalizeCiChangeContext(payload.changeContext);
  }
  if (payload.memory !== undefined) {
    payload.memory = normalizeStructuredMemory(payload.memory);
  }
  if (
    payload.changeContext &&
    payload.memory &&
    payload.changeContext.repository.toLowerCase() !==
      payload.memory.repository.toLowerCase()
  ) {
    throw new Error(
      'AI Container memory repository does not match changeContext.repository.',
    );
  }
  payload.environment = selectedEnvironment;
  if (
    payload.gcpAccessToken !== undefined &&
    typeof payload.gcpAccessToken !== 'string'
  ) {
    throw new Error('AI Container gcpAccessToken must be a string.');
  }
  payload.gcpAccessToken = payload.gcpAccessToken?.trim() || undefined;
  payload.nodeOutputs = record(payload.nodeOutputs);
  if (payload.requirements !== undefined) {
    payload.requirements = normalizeRequirements(payload.requirements);
  }
  payload.runnerControl = {
    controlSubscriptionName: requiredPubSubSegment(
      runnerControl.controlSubscriptionName,
      'controlSubscriptionName',
    ),
    projectId: requiredPubSubSegment(runnerControl.projectId, 'projectId'),
    protocolToken: (() => {
      if (!isRunnerProtocolToken(runnerControl.protocolToken)) {
        throw new Error('AI Container runnerControl.protocolToken is invalid.');
      }
      return runnerControl.protocolToken;
    })(),
    topicName: requiredPubSubSegment(runnerControl.topicName, 'topicName'),
    type: 'gcp_pubsub',
  };
  const runtime = record(payload.runtime);
  for (const field of [
    'cloudProvider',
    'editorApiUrl',
    'executionAuthToken',
    'nodeId',
    'testId',
    'workflowId',
  ]) {
    if (typeof runtime[field] !== 'string' || !runtime[field].trim()) {
      throw new Error(`AI Container runtime.${field} is required.`);
    }
  }
  payload.runtime = {
    ...(typeof runtime.bucketName === 'string' && runtime.bucketName.trim()
      ? { bucketName: runtime.bucketName.trim() }
      : {}),
    cloudProvider: String(runtime.cloudProvider).trim(),
    editorApiUrl: requiredEditorApiOrigin(runtime.editorApiUrl),
    executionAuthToken: String(runtime.executionAuthToken).trim(),
    nodeId: requiredRuntimeIdentifier(runtime.nodeId, 'nodeId'),
    testId: requiredRuntimeIdentifier(runtime.testId, 'testId'),
    workflowId: requiredRuntimeIdentifier(runtime.workflowId, 'workflowId'),
  };
  if (attachmentIds.includes(payload.runtime.nodeId)) {
    throw new Error(
      'AI Container attachment node IDs must differ from the container node ID.',
    );
  }
  return payload;
}

function configuredNumber(
  config: Record<string, unknown>,
  key: keyof typeof DEFAULT_MINIMUMS,
): number {
  const minimum = record(config.minimum);
  if (minimum[key] === undefined) return DEFAULT_MINIMUMS[key];
  const value = Number(minimum[key]);
  return Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : DEFAULT_MINIMUMS[key];
}

export function mergeValidatorConfigs(
  payload: AgentRunnerPayload,
): ValidatorConfig {
  const configs = payload.validators.map((validator) => {
    if (validator.nodeType !== 'validator') {
      throw new Error(
        `Unsupported Validator attachment: ${validator.nodeType}`,
      );
    }
    return record(validator.config);
  });
  const validationCommands = Array.from(
    new Set(
      configs
        .map((config) => String(config.validationCommand || '').trim())
        .filter(Boolean),
    ),
  );
  if (validationCommands.length > 1) {
    throw new Error(
      'Attached Validators configure different validation commands. Use one authoritative command.',
    );
  }
  const timeoutValues = configs
    .map((config) => Number(config.validationTimeoutMinutes))
    .filter((value) => Number.isFinite(value) && value > 0);
  return {
    coverageSummaryPaths: Array.from(
      new Set(
        configs.flatMap((config) => {
          const paths = config.coverageSummaryPaths;
          return Array.isArray(paths)
            ? paths
                .map(String)
                .map((value) => value.trim())
                .filter(Boolean)
            : [...DEFAULT_COVERAGE_SUMMARY_PATHS];
        }),
      ),
    ),
    failOn: Array.from(
      new Set(
        configs.flatMap((config) =>
          Array.isArray(config.failOn)
            ? config.failOn.map(String)
            : [...DEFAULT_FAIL_ON],
        ),
      ),
    ),
    minimum: {
      assertionQuality: Math.max(
        ...configs.map((config) =>
          configuredNumber(config, 'assertionQuality'),
        ),
      ),
      branchCoverage: Math.max(
        ...configs.map((config) => configuredNumber(config, 'branchCoverage')),
      ),
      changedLineCoverage: Math.max(
        ...configs.map((config) =>
          configuredNumber(config, 'changedLineCoverage'),
        ),
      ),
      lineCoverage: Math.max(
        ...configs.map((config) => configuredNumber(config, 'lineCoverage')),
      ),
      requirementCoverage: Math.max(
        ...configs.map((config) =>
          configuredNumber(config, 'requirementCoverage'),
        ),
      ),
    },
    requirements: [
      ...configs.map((config) => String(config.requirements || '').trim()),
      ...(payload.requirements || []).map(
        (requirement) => `${requirement.id}: ${requirement.title}`,
      ),
    ]
      .filter(Boolean)
      .join('\n'),
    runTests: true,
    ...(validationCommands[0]
      ? { validationCommand: validationCommands[0] }
      : {}),
    ...(timeoutValues.length
      ? { validationTimeoutMinutes: Math.min(...timeoutValues) }
      : {}),
  };
}

export function materializeNodeOutputs(
  payload: AgentRunnerPayload,
  target = '/workspace/inputs/workflow-inputs.json',
): string {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    `${JSON.stringify(payload.nodeOutputs || {}, null, 2)}\n`,
    { mode: 0o444 },
  );
  return target;
}

function materializeReadOnlyJson(value: unknown, target: string): string {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o444,
  });
  return target;
}

export function materializeAgentContext(
  payload: AgentRunnerPayload,
  changeManifest?: ChangeManifest,
  directory = '/workspace/inputs',
  supportingRepositories: Array<{
    branch: string;
    folder: string;
    headRevision: string;
    repository: string;
    repositoryRoot: string;
    workingDirectory: string;
  }> = [],
  primaryRepositoryRoot = '/workspace/repo',
): MaterializedAgentContext {
  if (Boolean(payload.changeContext) !== Boolean(changeManifest)) {
    throw new Error(
      'AI Container change context and its authoritative change manifest must be materialized together.',
    );
  }
  if (
    payload.changeContext &&
    changeManifest &&
    (payload.changeContext.repository.toLowerCase() !==
      changeManifest.context.repository.toLowerCase() ||
      payload.changeContext.baseRef !== changeManifest.context.baseRef ||
      payload.changeContext.baseSha !== changeManifest.context.baseSha ||
      payload.changeContext.eventType !== changeManifest.context.eventType ||
      payload.changeContext.headRef !== changeManifest.context.headRef ||
      payload.changeContext.headSha !== changeManifest.context.headSha ||
      payload.changeContext.pullRequestNumber !==
        changeManifest.context.pullRequestNumber)
  ) {
    throw new Error(
      'AI Container change manifest does not match the trusted change context.',
    );
  }
  const nodeOutputsPath = materializeReadOnlyJson(
    payload.nodeOutputs || {},
    path.join(directory, 'workflow-inputs.json'),
  );
  const changeManifestPath = changeManifest
    ? materializeReadOnlyJson(
        changeManifest,
        path.join(directory, 'change-manifest.json'),
      )
    : undefined;
  const memoryPath = payload.memory
    ? materializeReadOnlyJson(
        payload.memory,
        path.join(directory, 'previous-memory.json'),
      )
    : undefined;
  const requirementsPath = payload.requirements?.length
    ? materializeReadOnlyJson(
        payload.requirements,
        path.join(directory, 'requirements.json'),
      )
    : undefined;
  const repositoriesPath = materializeReadOnlyJson(
    [
      {
        branch: String(payload.config.branch || 'main'),
        editable: true,
        folder: String(payload.config.folder || '.'),
        repository: String(payload.config.repository || ''),
        repositoryRoot: primaryRepositoryRoot,
        role: 'primary',
      },
      ...supportingRepositories.map((repository) => ({
        branch: repository.branch,
        editable: false,
        folder: repository.folder,
        headRevision: repository.headRevision,
        repository: repository.repository,
        repositoryRoot: repository.repositoryRoot,
        role: 'supporting',
        workingDirectory: repository.workingDirectory,
      })),
    ],
    path.join(directory, 'repositories.json'),
  );
  return {
    ...(changeManifestPath ? { changeManifestPath } : {}),
    ...(memoryPath ? { memoryPath } : {}),
    nodeOutputsPath,
    repositoriesPath,
    ...(requirementsPath ? { requirementsPath } : {}),
  };
}

export function createInitialPrompt(
  payload: AgentRunnerPayload,
  context: MaterializedAgentContext | string,
): string {
  const agentConfig = record(payload.agent.config);
  const materialized =
    typeof context === 'string' ? { nodeOutputsPath: context } : context;
  if (payload.changeContext && !materialized.changeManifestPath) {
    throw new Error(
      'AI Container initial prompt requires the authoritative change manifest path.',
    );
  }
  if (payload.memory && !materialized.memoryPath) {
    throw new Error(
      'AI Container initial prompt requires the structured memory path.',
    );
  }
  const changeInstructions = payload.changeContext
    ? [
        'This is a CI change-driven run. The supplied base and head commits are immutable and authoritative.',
        `Analyze ${payload.changeContext.repository} from ${payload.changeContext.baseSha} (${payload.changeContext.baseRef}) to ${payload.changeContext.headSha} (${payload.changeContext.headRef}).`,
        `Read the deterministic change manifest at ${materialized.changeManifestPath}. Start with changed production files and their inclusive changed-line ranges, then inspect enough surrounding code to understand each observable behavior.`,
        'For every changed production behavior, find direct existing test evidence or add focused tests. Do not duplicate tests when current coverage already proves the behavior, and do not manufacture tests for config-only changes.',
        'Keep generated work scoped to tests and approved standalone test configuration. You may install dependencies already declared by the repository for this run, but do not edit package manifests or lockfiles and do not add dependencies. Do not push, commit, or open a pull request; Playrunner will publish the resulting patch through a bot PR.',
        'The validator independently runs the container-owned Playwright CLI; it does not require or invoke a package.json test script. Detailed Istanbul coverage-final JSON or LCOV DA records already produced at coverage/coverage-final.json or coverage/lcov.info are consumed as additional evidence. Never create or edit those reports from test/config code, mutate coverage globals or environment, or add a custom report-writing process. The validator clears the fixed paths before the clean run and treats repository coverage as untrusted evidence; any generated pull request remains a draft for human or trusted CI review.',
      ].join('\n')
    : '';
  const memoryInstructions = payload.memory
    ? [
        `Read prior structured run memory at ${materialized.memoryPath}.`,
        'Use its generated-test paths, unresolved coverage gaps, validation summary, and bot PR reference as hints only. Verify everything against the current immutable head commit.',
        'This memory is a bounded outcome summary, not a conversation transcript. Do not assume access to or request a prior transcript, prompt, or model session.',
      ].join('\n')
    : '';
  const requirementInstructions = materialized.requirementsPath
    ? [
        `Read the normalized external requirements at ${materialized.requirementsPath}.`,
        'Treat their titles and bodies as product context and acceptance criteria. Preserve each source ID in test names or evidence where practical, and verify the requested behavior against the checked-out code rather than assuming the requirement is already implemented.',
      ].join('\n')
    : '';
  return [
    'You are running inside a Playrunner AI Container with Playwright and browsers installed.',
    'Work autonomously in the checked-out repository. Inspect the application, write or improve valuable tests, run them, and iterate until they pass.',
    changeInstructions,
    memoryInstructions,
    requirementInstructions,
    'The command `playrunner-validator` is available as a tool. Run it before reporting completion and address its precise feedback.',
    payload.changeContext
      ? ''
      : 'The validator independently runs the container-owned Playwright CLI with retries disabled; it does not require or invoke a package.json test script. Detailed Istanbul coverage-final JSON or LCOV DA records already produced at coverage/coverage-final.json or coverage/lcov.info are consumed as additional evidence. Never synthesize or edit coverage reports from test/config code.',
    'Do not merely make tests green: cover meaningful positive and negative behavior and use observable assertions.',
    `Read-only upstream workflow outputs are available as JSON at ${materialized.nodeOutputsPath}. Use them when the task depends on earlier nodes.`,
    materialized.repositoriesPath
      ? `The repository workspace manifest is at ${materialized.repositoriesPath}. Work in the primary repository. Inspect supporting repositories when behavior depends on shared code; they are intentionally read-only and must not be modified.`
      : '',
    `Task:\n${String(payload.config.task || (payload.changeContext ? 'Generate tests for changed production behavior.' : 'Write valuable Playwright end-to-end tests.'))}`,
    agentConfig.instructions
      ? `Additional instructions:\n${String(agentConfig.instructions)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}
