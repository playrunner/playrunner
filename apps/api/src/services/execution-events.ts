import crypto from 'crypto';
import type { Prisma, WorkflowEvent, WorkflowExecution } from '@prisma/client';
import { prisma } from '../lib/prisma';

export const EXECUTION_TOKEN_HEADER = 'x-execution-token';

type WorkflowEventDraft = Record<string, unknown>;

type StreamableWorkflowEvent = {
  sequence: bigint;
  payload: Record<string, unknown>;
};

function normalizeString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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
  workflowId?: string,
  nodeId?: string,
  type?: string,
  level?: string,
  message?: string,
) {
  const basePayload = sanitizeJsonRecord(event);

  return {
    ...basePayload,
    cloudProvider: normalizeString(basePayload.cloudProvider) ?? execution.cloudProvider,
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
  const payload = isRecord(event.payload) ? {...event.payload} : {};
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
      workflowId: normalizeString(payload.workflowId) ?? event.workflowId ?? null,
    },
  };
}

async function getExecutionOrThrow(executionId: string) {
  const execution = await prisma.workflowExecution.findUnique({
    where: {id: executionId},
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

  async verifyExecutionToken(executionId: string, token: string) {
    const execution = await prisma.workflowExecution.findUnique({
      where: {id: executionId},
    });

    if (!execution || !isMatchingExecutionToken(token, execution.ingestTokenHash)) {
      return null;
    }

    return execution;
  }

  async appendEvent(executionId: string, event: WorkflowEventDraft) {
    const execution = await getExecutionOrThrow(executionId);
    const type = normalizeString(event.type) ?? (normalizeString(event.message) ? 'log' : 'event');
    const level = normalizeString(event.level);
    const message = normalizeString(event.message);
    const nodeId = normalizeString(event.nodeId);
    const workflowId = normalizeString(event.workflowId) ?? execution.workflowId ?? undefined;
    const occurredAt = parseOccurredAt(event.timestamp) ?? new Date();
    const payload = buildStoredPayload(
      execution,
      event,
      occurredAt,
      workflowId,
      nodeId,
      type,
      level,
      message,
    );

    const storedEvent = await prisma.workflowEvent.create({
      data: {
        executionId: execution.id,
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

    if (type === 'workflow_completed' || type === 'workflow_failed' || type === 'workflow_cancelled') {
      await prisma.workflowExecution.update({
        where: {id: execution.id},
        data: {
          status: type === 'workflow_failed' ? 'failed' : type === 'workflow_cancelled' ? 'cancelled' : 'completed',
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
}

export const executionEvents = new ExecutionEventsService();
