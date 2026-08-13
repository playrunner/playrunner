export const WORKFLOW_LOG_LEVELS = [
  'info',
  'error',
  'warn',
  'build',
  'debug',
] as const;

export type WorkflowDiagnosticLogLevel = (typeof WORKFLOW_LOG_LEVELS)[number];

export type WorkflowDiagnosticLog = {
  level: WorkflowDiagnosticLogLevel;
  message: string;
  nodeId?: string;
  timestamp: string;
};

export type WorkflowDiagnosticLogs = {
  all: WorkflowDiagnosticLog[];
  build: WorkflowDiagnosticLog[];
  debug: WorkflowDiagnosticLog[];
  error: WorkflowDiagnosticLog[];
  info: WorkflowDiagnosticLog[];
  warn: WorkflowDiagnosticLog[];
};

const MAX_DIAGNOSTIC_LOG_MESSAGE_LENGTH = 10_000;

export function sanitizeDiagnosticLogMessage(message: string) {
  return message
    .slice(0, MAX_DIAGNOSTIC_LOG_MESSAGE_LENGTH)
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

export function createWorkflowDiagnosticLogs(): WorkflowDiagnosticLogs {
  return {
    all: [],
    build: [],
    debug: [],
    error: [],
    info: [],
    warn: [],
  };
}

export function appendWorkflowDiagnosticLog(
  logs: WorkflowDiagnosticLogs,
  entry: WorkflowDiagnosticLog,
) {
  if (
    !WORKFLOW_LOG_LEVELS.includes(entry.level) ||
    typeof entry.message !== 'string' ||
    typeof entry.timestamp !== 'string'
  ) {
    return;
  }

  const safeEntry = {
    ...entry,
    message: sanitizeDiagnosticLogMessage(entry.message),
  };
  logs.all.push(safeEntry);
  logs[entry.level].push(safeEntry);
  logs.all.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  logs[entry.level].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  );
}
