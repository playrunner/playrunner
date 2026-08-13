import { sanitizeWorkflowLogMessage } from './execution-events';

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

type WorkflowHistoryLogs = {
  all: WorkflowHistoryLog[];
  build: WorkflowHistoryLog[];
  debug: WorkflowHistoryLog[];
  error: WorkflowHistoryLog[];
  info: WorkflowHistoryLog[];
  warn: WorkflowHistoryLog[];
};

const HISTORY_LOG_LEVELS = new Set(['build', 'debug', 'error', 'info', 'warn']);

function createHistoryLogs(): WorkflowHistoryLogs {
  return {
    all: [],
    build: [],
    debug: [],
    error: [],
    info: [],
    warn: [],
  };
}

function appendHistoryLog(
  logs: WorkflowHistoryLogs,
  event: WorkflowHistoryEvent,
) {
  const message = sanitizeWorkflowLogMessage(event.message);
  if (!message) return;

  const level = HISTORY_LOG_LEVELS.has(event.level || '')
    ? (event.level as keyof Omit<WorkflowHistoryLogs, 'all'>)
    : 'info';
  const entry: WorkflowHistoryLog = {
    executionId: event.executionId,
    level,
    message,
    ...(event.nodeId ? { nodeId: event.nodeId } : {}),
    timestamp: (event.occurredAt || new Date(0)).toISOString(),
  };
  logs.all.push(entry);
  logs[level].push(entry);
}

function durationMs(startedAt: Date, completedAt: Date | null) {
  return completedAt
    ? Math.max(0, completedAt.getTime() - startedAt.getTime())
    : null;
}

export function buildWorkflowHistory(executions: WorkflowHistoryExecution[]) {
  const allLogs = createHistoryLogs();
  const runs = executions.map((execution) => {
    const logs = createHistoryLogs();
    const sharding: unknown[] = [];

    for (const event of execution.events) {
      if (event.type === 'log') {
        appendHistoryLog(logs, event);
        appendHistoryLog(allLogs, event);
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

  return { logs: allLogs, runs };
}
