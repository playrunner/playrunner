import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.cts';
import { prisma } from '../lib/prisma';

export const MAX_AGENT_MEMORY_BYTES = 64 * 1024;
export const MAX_AGENT_MEMORY_DEPTH = 8;
const MAX_ENTRIES = 20_000;
const MAX_STRING_BYTES = 16 * 1024;
const MAX_LOADED_BYTES = 512 * 1024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;
const SAFE_NAMESPACE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

type JsonRecord = Record<string, unknown>;
type WorkflowGraph = {
  connections: unknown;
  id: string;
  nodes: unknown;
  projectId: string | null;
  userId: string;
};
type MemoryBinding = {
  namespace: string;
  repository: string;
  scopeId: string;
  scopeKind: 'project' | 'workflow';
};
export type AgentMemoryPersistenceData = MemoryBinding & {
  ownerUserId: string;
  projectId: string | null;
  providerId: string;
  sourceExecutionCreatedAt: Date;
  sourceExecutionId: string;
  sourceHeadSha: string | null;
  state: Prisma.InputJsonValue;
  workflowId: string | null;
};
type ExecuteSql = (query: Prisma.Sql) => Promise<number>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateJson(
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
    if (Buffer.byteLength(value, 'utf8') > MAX_STRING_BYTES) {
      throw new Error('Agent memory contains an oversized string.');
    }
    return;
  }
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : isRecord(value)
      ? Object.entries(value)
      : null;
  if (!entries) throw new Error('Agent memory must contain only JSON values.');
  state.entries += entries.length;
  if (state.entries > MAX_ENTRIES) {
    throw new Error('Agent memory contains too many entries.');
  }
  for (const [key, item] of entries) {
    if (
      !Array.isArray(value) &&
      (!key || key.length > 100 || UNSAFE_KEYS.has(key))
    ) {
      throw new Error('Agent memory contains an invalid object key.');
    }
    validateJson(item, depth + 1, state);
  }
}

export function parseAgentMemory(value: unknown): JsonRecord {
  if (!isRecord(value)) {
    throw new Error('Agent node output.memory must be a JSON object.');
  }
  validateJson(value, 0, { entries: 0 });
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_AGENT_MEMORY_BYTES) {
    throw new Error(`Agent memory exceeds ${MAX_AGENT_MEMORY_BYTES} bytes.`);
  }
  return JSON.parse(serialized) as JsonRecord;
}

export function extractAgentMemoryFromEvent(
  event: Record<string, unknown>,
): JsonRecord | null {
  if (event.type !== 'node_output' || !isRecord(event.output)) return null;
  return Object.hasOwn(event.output, 'memory')
    ? parseAgentMemory(event.output.memory)
    : null;
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

export function resolveMemoryBinding(
  workflow: WorkflowGraph,
  containerNodeId: string,
): MemoryBinding | null {
  if (!Array.isArray(workflow.nodes) || !Array.isArray(workflow.connections)) {
    return null;
  }
  const container = workflow.nodes.find(
    (node) =>
      isRecord(node) &&
      node.id === containerNodeId &&
      node.nodeType === 'agent-container',
  );
  if (!isRecord(container)) return null;
  const memoryIds = workflow.connections
    .filter(
      (connection) =>
        isRecord(connection) &&
        connection.role === 'attachment' &&
        connection.attachmentPort === 'memory' &&
        connection.targetId === containerNodeId &&
        typeof connection.sourceId === 'string',
    )
    .map((connection) => String((connection as JsonRecord).sourceId));
  if (memoryIds.length !== 1) return null;
  const memoryNode = workflow.nodes.find(
    (node) =>
      isRecord(node) &&
      node.id === memoryIds[0] &&
      node.nodeType === 'project-memory',
  );
  if (!isRecord(memoryNode)) return null;
  const containerConfig = isRecord(container.config) ? container.config : {};
  const repository =
    typeof containerConfig.repository === 'string'
      ? containerConfig.repository.trim()
      : '';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return null;
  const config = isRecord(memoryNode.config) ? memoryNode.config : {};
  const requestedNamespace =
    typeof config.namespace === 'string' ? config.namespace.trim() : '';
  const namespace = SAFE_NAMESPACE.test(requestedNamespace)
    ? requestedNamespace
    : 'project';
  const projectScoped = config.scope !== 'workflow' && workflow.projectId;
  return {
    namespace,
    repository,
    scopeId: projectScoped ? workflow.projectId! : workflow.id,
    scopeKind: projectScoped ? 'project' : 'workflow',
  };
}

async function findWorkflow(workflowId: string): Promise<WorkflowGraph | null> {
  return prisma.workflow.findUnique({
    select: {
      connections: true,
      id: true,
      nodes: true,
      projectId: true,
      userId: true,
    },
    where: { id: workflowId },
  });
}

export async function loadAgentMemoryByNodeId(params: {
  connections?: unknown;
  nodes?: unknown;
  workflowId: string;
}): Promise<Record<string, JsonRecord>> {
  const saved = await findWorkflow(params.workflowId);
  if (!saved) return {};
  const workflow: WorkflowGraph = {
    ...saved,
    connections: params.connections ?? saved.connections,
    nodes: params.nodes ?? saved.nodes,
  };
  const result: Record<string, JsonRecord> = Object.create(null);
  let loadedBytes = 2;
  for (const node of Array.isArray(workflow.nodes) ? workflow.nodes : []) {
    if (!isRecord(node) || node.nodeType !== 'agent-container') continue;
    const nodeId = typeof node.id === 'string' ? node.id : '';
    if (!SAFE_ID.test(nodeId)) continue;
    const binding = resolveMemoryBinding(workflow, nodeId);
    if (!binding) continue;
    const row = await prisma.projectMemory.findUnique({
      where: {
        ownerUserId_providerId_scopeKind_scopeId_repository_namespace: {
          ...binding,
          ownerUserId: workflow.userId,
          providerId: 'project-memory',
        },
      },
    });
    if (!row) continue;
    const memory = parseAgentMemory(row.state);
    const bytes = Buffer.byteLength(JSON.stringify({ [nodeId]: memory }));
    if (loadedBytes + bytes > MAX_LOADED_BYTES) break;
    result[nodeId] = memory;
    loadedBytes += bytes;
  }
  return result;
}

export async function persistAgentMemoryRecord(
  data: AgentMemoryPersistenceData,
  executeSql: ExecuteSql = (query) => prisma.$executeRaw(query),
) {
  await executeSql(Prisma.sql`
    INSERT INTO "ProjectMemory" (
      "id",
      "ownerUserId",
      "providerId",
      "scopeKind",
      "scopeId",
      "projectId",
      "workflowId",
      "repository",
      "namespace",
      "revision",
      "sourceHeadSha",
      "sourceExecutionId",
      "sourceExecutionCreatedAt",
      "state",
      "createdAt",
      "updatedAt"
    ) VALUES (
      ${randomUUID()},
      ${data.ownerUserId},
      ${data.providerId},
      ${data.scopeKind},
      ${data.scopeId},
      ${data.projectId},
      ${data.workflowId},
      ${data.repository},
      ${data.namespace},
      1,
      ${data.sourceHeadSha},
      ${data.sourceExecutionId},
      ${data.sourceExecutionCreatedAt},
      ${JSON.stringify(data.state)}::jsonb,
      NOW(),
      NOW()
    )
    ON CONFLICT (
      "ownerUserId",
      "providerId",
      "scopeKind",
      "scopeId",
      "repository",
      "namespace"
    ) DO UPDATE SET
      "revision" = "ProjectMemory"."revision" + 1,
      "projectId" = EXCLUDED."projectId",
      "workflowId" = EXCLUDED."workflowId",
      "sourceHeadSha" = EXCLUDED."sourceHeadSha",
      "sourceExecutionId" = EXCLUDED."sourceExecutionId",
      "sourceExecutionCreatedAt" = EXCLUDED."sourceExecutionCreatedAt",
      "state" = EXCLUDED."state",
      "updatedAt" = NOW()
    WHERE
      "ProjectMemory"."sourceExecutionCreatedAt"
        <= EXCLUDED."sourceExecutionCreatedAt"
  `);
}

export async function persistAgentMemoryFromEvent(params: {
  event: Record<string, unknown>;
  executionId: string;
  nodeId?: string;
}) {
  const memory = extractAgentMemoryFromEvent(params.event);
  if (!memory) return;
  const nodeId = params.nodeId?.trim() || '';
  if (!SAFE_ID.test(nodeId)) {
    throw new Error('Agent memory event is missing a safe node ID.');
  }
  const execution = await prisma.workflowExecution.findUnique({
    select: { createdAt: true, userId: true, workflowId: true },
    where: { id: params.executionId },
  });
  if (!execution?.workflowId) return;
  const workflow = await findWorkflow(execution.workflowId);
  if (!workflow || workflow.userId !== execution.userId) return;
  const binding = resolveMemoryBinding(workflow, nodeId);
  if (!binding) return;
  if (memory.repository !== binding.repository) {
    throw new Error('Agent memory repository does not match its Memory scope.');
  }
  const unique = {
    ...binding,
    ownerUserId: workflow.userId,
    providerId: 'project-memory',
  };
  const data = {
    ...unique,
    projectId: binding.scopeKind === 'project' ? binding.scopeId : null,
    sourceExecutionCreatedAt: execution.createdAt,
    sourceExecutionId: params.executionId,
    sourceHeadSha:
      typeof memory.lastProcessedHeadSha === 'string'
        ? memory.lastProcessedHeadSha
        : null,
    state: memory as Prisma.InputJsonValue,
    workflowId: binding.scopeKind === 'workflow' ? binding.scopeId : null,
  };
  await persistAgentMemoryRecord(data);
}
