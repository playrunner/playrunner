import crypto from 'crypto';
import type {
  Prisma,
  WorkflowEvent,
  WorkflowExecution,
} from '../generated/prisma/client.cts';
import { prisma } from '../lib/prisma';

export const EXECUTION_TOKEN_HEADER = 'x-execution-token';

type WorkflowEventDraft = Record<string, unknown>;

type StreamableWorkflowEvent = {
  sequence: bigint;
  payload: Record<string, unknown>;
};

const SAFE_EVENT_MESSAGES: Record<string, string> = {
  workflow_started: 'Workflow started.',
  workflow_completed: 'Workflow completed.',
  workflow_failed: 'Workflow failed.',
  workflow_cancelled: 'Workflow cancelled.',
  node_started: 'Node started.',
  node_completed: 'Node completed.',
  node_failed: 'Node failed.',
  node_cancelled: 'Node cancelled.',
};
const SAFE_NODE_STATES = new Set([
  'idle',
  'pending',
  'running',
  'success',
  'error',
  'warning',
]);
const SAFE_LEVELS = new Set(['debug', 'info', 'warn', 'error', 'success']);
const MAX_SAFE_LOG_LENGTH = 10_000;

function normalizeString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stripControlSequences(value: string) {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 27 && value[index + 1] === '[') {
      index += 2;
      while (index < value.length) {
        const sequenceCode = value.charCodeAt(index);
        if (sequenceCode >= 64 && sequenceCode <= 126) break;
        index += 1;
      }
      continue;
    }
    if (
      code === 9 ||
      code === 10 ||
      code === 13 ||
      (code >= 32 && code !== 127)
    ) {
      result += value[index];
    }
  }
  return result;
}

export function sanitizeWorkflowLogMessage(value: unknown) {
  const message = normalizeString(value);
  if (!message) return null;

  return stripControlSequences(message)
    .slice(0, MAX_SAFE_LOG_LENGTH)
    .replace(/pr_live_[a-zA-Z0-9_-]{10,}/g, '[redacted]')
    .replace(
      /\b(?:gh[pousr]_[a-zA-Z0-9_]{20,}|github_pat_[a-zA-Z0-9_]{20,}|sk-[a-zA-Z0-9_-]{20,})\b/g,
      '[redacted]',
    )
    .replace(/(Bearer\s+)[a-zA-Z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(
      /(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi,
      '$1[redacted]',
    )
    .replace(/([?&](?:token|key|secret|api_key)=)[^&#\s]+/gi, '$1[redacted]');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeJsonRecord(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function hashExecutionToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function isMatchingExecutionToken(token: string, expectedHash: string) {
  const provided = Buffer.from(hashExecutionToken(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');

  if (provided.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(provided, expected);
}

function parseOccurredAt(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return undefined;
}

function buildStoredPayload(
  execution: WorkflowExecution,
  event: WorkflowEventDraft,
  occurredAt: Date,
  sourceEventId?: string,
  workflowId?: string,
  nodeId?: string,
  type?: string,
  level?: string,
  message?: string,
) {
  const basePayload = sanitizeJsonRecord(event);

  return {
    ...basePayload,
    cloudProvider:
      normalizeString(basePayload.cloudProvider) ?? execution.cloudProvider,
    eventId: sourceEventId ?? normalizeString(basePayload.eventId) ?? null,
    executionId: execution.id,
    level: level ?? normalizeString(basePayload.level) ?? null,
    message: message ?? normalizeString(basePayload.message) ?? null,
    nodeId: nodeId ?? null,
    testId: execution.id,
    timestamp: occurredAt.toISOString(),
    type: type ?? 'log',
    workflowId: workflowId ?? execution.workflowId ?? null,
  };
}

function toJsonValue(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function toStreamableEvent(event: WorkflowEvent): StreamableWorkflowEvent {
  const payload = isRecord(event.payload) ? { ...event.payload } : {};
  const timestamp =
    normalizeString(payload.timestamp) ??
    event.occurredAt?.toISOString() ??
    event.createdAt.toISOString();

  return {
    sequence: event.id,
    payload: {
      ...payload,
      executionId: normalizeString(payload.executionId) ?? event.executionId,
      level: normalizeString(payload.level) ?? event.level ?? null,
      message: normalizeString(payload.message) ?? event.message ?? null,
      nodeId: normalizeString(payload.nodeId) ?? event.nodeId ?? null,
      sequence: event.id.toString(),
      testId: normalizeString(payload.testId) ?? event.executionId,
      timestamp,
      type: normalizeString(payload.type) ?? event.type,
      workflowId:
        normalizeString(payload.workflowId) ?? event.workflowId ?? null,
    },
  };
}

export function toSafeWorkflowEvent(event: StreamableWorkflowEvent) {
  const rawType = normalizeString(event.payload.type) ?? 'event';
  const rawState = normalizeString(event.payload.state);
  const state = rawState && SAFE_NODE_STATES.has(rawState) ? rawState : null;
  const type =
    rawType === 'log' && sanitizeWorkflowLogMessage(event.payload.message)
      ? 'log'
      : rawType === 'node_state' && state
        ? 'node_state'
        : Object.hasOwn(SAFE_EVENT_MESSAGES, rawType)
          ? rawType
          : 'event';
  const rawNodeId = normalizeString(event.payload.nodeId);
  const nodeId =
    rawNodeId && /^[a-zA-Z0-9_-]{1,100}$/.test(rawNodeId) ? rawNodeId : null;
  const rawLevel = normalizeString(event.payload.level);
  const rawTimestamp = normalizeString(event.payload.timestamp);
  const timestamp = rawTimestamp ? parseOccurredAt(rawTimestamp) : undefined;
  return {
    sequence: event.sequence.toString(),
    type,
    level: rawLevel && SAFE_LEVELS.has(rawLevel) ? rawLevel : null,
    message:
      type === 'log'
        ? sanitizeWorkflowLogMessage(event.payload.message)
        : type === 'node_state'
          ? `${nodeId ? `Node ${nodeId}` : 'Node'} is ${state}.`
          : (SAFE_EVENT_MESSAGES[type] ?? null),
    nodeId,
    state,
    timestamp: timestamp?.toISOString() ?? null,
  };
}

async function getExecutionOrThrow(executionId: string) {
  const execution = await prisma.workflowExecution.findUnique({
    where: { id: executionId },
  });

  if (!execution) {
    throw new Error(`Workflow execution ${executionId} was not found.`);
  }

  return execution;
}

class ExecutionEventsService {
  async createExecution(params: {
    cloudProvider: string;
    executionId: string;
    userId: string;
    workflowId?: string | null;
  }) {
    const executionToken = crypto.randomBytes(32).toString('hex');
    const execution = await prisma.workflowExecution.create({
      data: {
        id: params.executionId,
        userId: params.userId,
        workflowId: params.workflowId ?? null,
        cloudProvider: params.cloudProvider,
        ingestTokenHash: hashExecutionToken(executionToken),
      },
    });

    return {
      execution,
      executionToken,
    };
  }

  async getExecutionForUser(executionId: string, userId: string) {
    return prisma.workflowExecution.findFirst({
      where: {
        id: executionId,
        userId,
      },
    });
  }

  async getExecutionStatus(executionId: string) {
    const execution = await prisma.workflowExecution.findUnique({
      select: { status: true },
      where: { id: executionId },
    });

    return execution?.status ?? null;
  }

  async verifyExecutionToken(executionId: string, token: string) {
    const execution = await prisma.workflowExecution.findUnique({
      where: { id: executionId },
    });

    if (
      !execution ||
      !isMatchingExecutionToken(token, execution.ingestTokenHash)
    ) {
      return null;
    }

    return execution;
  }

  async appendEvent(executionId: string, event: WorkflowEventDraft) {
    const execution = await getExecutionOrThrow(executionId);
    const sourceEventId =
      normalizeString(event.eventId) ?? normalizeString(event.sourceEventId);
    const type =
      normalizeString(event.type) ??
      (normalizeString(event.message) ? 'log' : 'event');
    const level = normalizeString(event.level);
    const message = normalizeString(event.message);
    const nodeId = normalizeString(event.nodeId);
    const workflowId =
      normalizeString(event.workflowId) ?? execution.workflowId ?? undefined;
    const occurredAt = parseOccurredAt(event.timestamp) ?? new Date();
    const payload = buildStoredPayload(
      execution,
      event,
      occurredAt,
      sourceEventId,
      workflowId,
      nodeId,
      type,
      level,
      message,
    );

    let storedEvent: WorkflowEvent;
    try {
      storedEvent = await prisma.workflowEvent.create({
        data: {
          executionId: execution.id,
          sourceEventId: sourceEventId ?? null,
          userId: execution.userId,
          workflowId: workflowId ?? null,
          nodeId: nodeId ?? null,
          type,
          level: level ?? null,
          message: message ?? null,
          payload: toJsonValue(payload),
          occurredAt,
        },
      });
    } catch (error: any) {
      if (sourceEventId && error?.code === 'P2002') {
        const existingEvent = await prisma.workflowEvent.findUnique({
          where: { sourceEventId },
        });
        if (existingEvent?.executionId === execution.id) {
          return toStreamableEvent(existingEvent);
        }
      }
      throw error;
    }

    if (
      type === 'workflow_completed' ||
      type === 'workflow_failed' ||
      type === 'workflow_cancelled'
    ) {
      await prisma.workflowExecution.update({
        where: { id: execution.id },
        data: {
          status:
            type === 'workflow_failed'
              ? 'failed'
              : type === 'workflow_cancelled'
                ? 'cancelled'
                : 'completed',
          completedAt: new Date(),
        },
      });
    }

    return toStreamableEvent(storedEvent);
  }

  async listEvents(executionId: string, afterSequence: bigint, take = 100) {
    const events = await prisma.workflowEvent.findMany({
      where: {
        executionId,
        id: {
          gt: afterSequence,
        },
      },
      orderBy: {
        id: 'asc',
      },
      take,
    });

    return events.map(toStreamableEvent);
  }

  async listSafeEvents(executionId: string, afterSequence: bigint, take = 100) {
    const events = await this.listEvents(executionId, afterSequence, take);
    return events.map(toSafeWorkflowEvent);
  }
}

export const executionEvents = new ExecutionEventsService();
