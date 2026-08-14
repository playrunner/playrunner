import { sanitizeWorkflowLogMessage } from './execution-events';
import { prisma } from '../lib/prisma';

type WorkflowHistoryEvent = {
  executionId: string;
  level: string | null;
  message: string | null;
  nodeId: string | null;
  occurredAt: Date | null;
  payload: unknown;
  type: string;
};

type WorkflowHistoryExecution = {
  cloudProvider: string;
  completedAt: Date | null;
  events: WorkflowHistoryEvent[];
  id: string;
  startedAt: Date;
  status: string;
};

type WorkflowHistoryLog = {
  executionId: string;
  level: string;
  message: string;
  nodeId?: string;
  timestamp: string;
};

const HISTORY_LOG_LEVELS = new Set(['build', 'debug', 'error', 'info', 'warn']);
const MAX_HISTORY_RUNS = 5;
const MAX_HISTORY_EVENTS_PER_RUN = 100;
const MAX_HISTORY_BYTES = 256 * 1024;
const MAX_HISTORY_LOG_MESSAGE_LENGTH = 2_000;

function historyLog(event: WorkflowHistoryEvent): WorkflowHistoryLog | null {
  const message = sanitizeWorkflowLogMessage(event.message);
  if (!message) return null;

  const level = HISTORY_LOG_LEVELS.has(event.level || '')
    ? event.level!
    : 'info';
  return {
    executionId: event.executionId,
    level,
    message: message.slice(0, MAX_HISTORY_LOG_MESSAGE_LENGTH),
    ...(event.nodeId ? { nodeId: event.nodeId } : {}),
    timestamp: (event.occurredAt || new Date(0)).toISOString(),
  };
}

function durationMs(startedAt: Date, completedAt: Date | null) {
  return completedAt
    ? Math.max(0, completedAt.getTime() - startedAt.getTime())
    : null;
}

export function buildWorkflowHistory(executions: WorkflowHistoryExecution[]) {
  const runs = executions.slice(0, MAX_HISTORY_RUNS).map((execution) => {
    const logs: WorkflowHistoryLog[] = [];
    const sharding: unknown[] = [];

    for (const event of execution.events.slice(0, MAX_HISTORY_EVENTS_PER_RUN)) {
      if (event.type === 'log') {
        const log = historyLog(event);
        if (log) {
          logs.push(log);
        }
      } else if (
        event.type === 'shard_plan' ||
        event.type === 'playwright_execution_observation'
      ) {
        sharding.push(event.payload);
      }
    }

    return {
      diagnostics: { sharding },
      durationMs: durationMs(execution.startedAt, execution.completedAt),
      finishedAt: execution.completedAt?.toISOString() || '',
      id: execution.id,
      logs,
      runner: execution.cloudProvider,
      startedAt: execution.startedAt.toISOString(),
      status: execution.status,
    };
  });

  const history = { runs };
  while (
    history.runs.length > 0 &&
    Buffer.byteLength(JSON.stringify(history), 'utf8') > MAX_HISTORY_BYTES
  ) {
    history.runs.pop();
  }

  return history;
}

export async function loadWorkflowHistory(args: {
  currentExecutionId: string;
  userId: string;
  workflowId: string;
}) {
  const executions = await prisma.workflowExecution.findMany({
    orderBy: { startedAt: 'desc' },
    select: {
      cloudProvider: true,
      completedAt: true,
      events: {
        orderBy: { id: 'asc' },
        select: {
          executionId: true,
          level: true,
          message: true,
          nodeId: true,
          occurredAt: true,
          payload: true,
          type: true,
        },
        take: MAX_HISTORY_EVENTS_PER_RUN,
        where: {
          type: {
            in: ['log', 'shard_plan', 'playwright_execution_observation'],
          },
        },
      },
      id: true,
      startedAt: true,
      status: true,
    },
    take: MAX_HISTORY_RUNS,
    where: {
      id: { not: args.currentExecutionId },
      userId: args.userId,
      workflowId: args.workflowId,
    },
  });

  return buildWorkflowHistory(executions);
}
