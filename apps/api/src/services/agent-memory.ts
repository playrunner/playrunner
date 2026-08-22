import type { Prisma } from '../generated/prisma/client.cts';
import { prisma } from '../lib/prisma';
import type { CiChangeContext } from './ci-change-context';

export const MAX_AGENT_MEMORY_BYTES = 64 * 1024;
export const MAX_AGENT_MEMORY_DEPTH = 8;
const MAX_AGENT_MEMORY_ENTRIES = 20_000;
const MAX_AGENT_MEMORY_KEY_LENGTH = 100;
const MAX_AGENT_MEMORY_STRING_BYTES = 16 * 1024;
const MAX_AGENT_MEMORIES_PER_WORKFLOW = 100;
const MAX_LOADED_AGENT_MEMORY_BYTES = 512 * 1024;
const SAFE_NODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

type JsonRecord = Record<string, unknown>;
type AgentMemoryChangeContext = Pick<
  CiChangeContext,
  'eventType' | 'headRef' | 'pullRequestNumber' | 'repository'
>;
type AgentMemoryScopeContext = {
  eventType: string;
  headRef: string;
  pullRequestNumber?: number | null;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

function validateJsonValue(
  value: unknown,
  depth: number,
  state: { entries: number },
): void {
  if (depth > MAX_AGENT_MEMORY_DEPTH) {
    throw new Error(
      `Agent memory exceeds the maximum depth of ${MAX_AGENT_MEMORY_DEPTH}.`,
    );
  }
  if (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return;
  }
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > MAX_AGENT_MEMORY_STRING_BYTES) {
      throw new Error('Agent memory contains an oversized string.');
    }
    return;
  }
  if (Array.isArray(value)) {
    state.entries += value.length;
    if (state.entries > MAX_AGENT_MEMORY_ENTRIES) {
      throw new Error('Agent memory contains too many entries.');
    }
    for (const item of value) validateJsonValue(item, depth + 1, state);
    return;
  }
  if (!isRecord(value)) {
    throw new Error('Agent memory must contain only JSON values.');
  }
  const entries = Object.entries(value);
  state.entries += entries.length;
  if (state.entries > MAX_AGENT_MEMORY_ENTRIES) {
    throw new Error('Agent memory contains too many entries.');
  }
  for (const [key, item] of entries) {
    if (
      !key ||
      key.length > MAX_AGENT_MEMORY_KEY_LENGTH ||
      UNSAFE_OBJECT_KEYS.has(key)
    ) {
      throw new Error('Agent memory contains an invalid object key.');
    }
    validateJsonValue(item, depth + 1, state);
  }
}

export function parseAgentMemory(value: unknown): JsonRecord {
  if (!isRecord(value)) {
    throw new Error('Agent node output.memory must be a JSON object.');
  }
  validateJsonValue(value, 0, { entries: 0 });
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error('Agent memory must be serializable JSON.');
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_AGENT_MEMORY_BYTES) {
    throw new Error(`Agent memory exceeds ${MAX_AGENT_MEMORY_BYTES} bytes.`);
  }
  return JSON.parse(serialized) as JsonRecord;
}

export function extractAgentMemoryFromEvent(
  event: Record<string, unknown>,
): JsonRecord | null {
  if (event.type !== 'node_output' || !isRecord(event.output)) return null;
  if (!Object.hasOwn(event.output, 'memory')) return null;
  return parseAgentMemory(event.output.memory);
}

export function isAgentContainerWorkflowNode(
  nodes: unknown,
  nodeId: string,
): boolean {
  return (
    Array.isArray(nodes) &&
    nodes.some(
      (node) =>
        isRecord(node) &&
        node.id === nodeId &&
        node.nodeType === 'agent-container',
    )
  );
}

export function assertAgentMemoryMatchesCiExecution(
  memory: JsonRecord,
  ciExecution: { headSha: string; repository: string },
) {
  if (memory.schemaVersion !== '1.0') {
    throw new Error('Agent memory has an unsupported schemaVersion.');
  }
  if (memory.repository !== ciExecution.repository) {
    throw new Error('Agent memory repository does not match the CI execution.');
  }
  if (memory.lastProcessedHeadSha !== ciExecution.headSha) {
    throw new Error('Agent memory head SHA does not match the CI execution.');
  }
}

export function agentMemoryChangeScope(
  context: AgentMemoryScopeContext,
): string {
  if (context.eventType === 'pull_request') {
    if (
      !Number.isSafeInteger(context.pullRequestNumber) ||
      Number(context.pullRequestNumber) < 1 ||
      Number(context.pullRequestNumber) > 2_147_483_647
    ) {
      throw new Error(
        'Agent memory pull request scope requires a positive 32-bit pull request number.',
      );
    }
    return `pr:${context.pullRequestNumber}`;
  }
  if (
    context.pullRequestNumber !== undefined &&
    context.pullRequestNumber !== null
  ) {
    throw new Error(
      'Agent memory ref scope cannot contain a pull request number.',
    );
  }
  const headRef = context.headRef.trim();
  if (!headRef || Buffer.byteLength(headRef, 'utf8') > 255) {
    throw new Error('Agent memory ref scope requires a bounded head ref.');
  }
  return `ref:${headRef}`;
}

export async function persistAgentMemoryFromEvent(params: {
  event: Record<string, unknown>;
  executionId: string;
  nodeId?: string;
}) {
  if (params.event.type !== 'node_output' || !isRecord(params.event.output)) {
    return;
  }
  if (!Object.hasOwn(params.event.output, 'memory')) return;
  const nodeId = params.nodeId?.trim();
  if (!nodeId || !SAFE_NODE_ID_PATTERN.test(nodeId)) {
    throw new Error('Agent memory event is missing a safe node ID.');
  }
  const ciExecution = await prisma.workflowCiExecution.findUnique({
    select: {
      createdAt: true,
      eventType: true,
      headRef: true,
      headSha: true,
      pullRequestNumber: true,
      repository: true,
      workflowId: true,
      workflow: { select: { nodes: true } },
    },
    where: { executionId: params.executionId },
  });
  if (!ciExecution) return;
  if (!isAgentContainerWorkflowNode(ciExecution.workflow.nodes, nodeId)) return;
  const memory = parseAgentMemory(params.event.output.memory);
  assertAgentMemoryMatchesCiExecution(memory, ciExecution);
  const changeScope = agentMemoryChangeScope(ciExecution);

  try {
    await prisma.workflowAgentMemory.create({
      data: {
        changeScope,
        headSha: ciExecution.headSha,
        memory: memory as Prisma.InputJsonValue,
        nodeId,
        repository: ciExecution.repository,
        sourceExecutionCreatedAt: ciExecution.createdAt,
        workflowId: ciExecution.workflowId,
      },
    });
  } catch (error) {
    if (!isPrismaUniqueConstraintError(error)) throw error;
    // Concurrent runs on one branch may complete out of order. Only a run
    // reserved at least as recently as the stored run may advance memory.
    await prisma.workflowAgentMemory.updateMany({
      data: {
        headSha: ciExecution.headSha,
        memory: memory as Prisma.InputJsonValue,
        sourceExecutionCreatedAt: ciExecution.createdAt,
      },
      where: {
        changeScope,
        nodeId,
        repository: ciExecution.repository,
        sourceExecutionCreatedAt: { lte: ciExecution.createdAt },
        workflowId: ciExecution.workflowId,
      },
    });
  }
}

export async function loadAgentMemoryByNodeId(params: {
  changeContext: AgentMemoryChangeContext;
  workflowId: string;
}): Promise<Record<string, JsonRecord>> {
  const changeScope = agentMemoryChangeScope(params.changeContext);
  const rows = await prisma.workflowAgentMemory.findMany({
    orderBy: { updatedAt: 'desc' },
    take: MAX_AGENT_MEMORIES_PER_WORKFLOW,
    where: {
      changeScope,
      repository: params.changeContext.repository,
      workflowId: params.workflowId,
    },
  });
  const result: Record<string, JsonRecord> = Object.create(null);
  let bytes = 2;
  for (const row of rows) {
    if (
      !SAFE_NODE_ID_PATTERN.test(row.nodeId) ||
      Object.hasOwn(result, row.nodeId)
    ) {
      continue;
    }
    const memory = parseAgentMemory(row.memory);
    const entryBytes = Buffer.byteLength(
      JSON.stringify({ [row.nodeId]: memory }),
      'utf8',
    );
    if (bytes + entryBytes > MAX_LOADED_AGENT_MEMORY_BYTES) break;
    result[row.nodeId] = memory;
    bytes += entryBytes;
  }
  return result;
}
