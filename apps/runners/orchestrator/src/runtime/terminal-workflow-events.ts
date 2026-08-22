import { randomUUID } from 'node:crypto';

export const TERMINAL_EVENT_MAX_PUBLISH_ATTEMPTS = 3;
export const TERMINAL_EVENT_RETRY_BASE_DELAY_MS = 250;

export type TerminalWorkflowEventPayload = Record<string, unknown> & {
  type: 'workflow_completed' | 'workflow_failed';
};

export type TerminalWorkflowEventRetryOptions = {
  randomUUID?: () => string;
  sleep?: (delayMs: number) => Promise<void>;
};

export class WorkflowEventPublishError extends Error {
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { cause?: unknown; retryable: boolean },
  ) {
    super(message, { cause: options.cause });
    this.name = 'WorkflowEventPublishError';
    this.retryable = options.retryable;
  }
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function publishTerminalWorkflowEvent(
  payload: TerminalWorkflowEventPayload,
  publishAttempt: (payload: TerminalWorkflowEventPayload) => Promise<void>,
  options: TerminalWorkflowEventRetryOptions = {},
): Promise<void> {
  const suppliedEventId =
    typeof payload.eventId === 'string' ? payload.eventId.trim() : '';
  const terminalPayload = {
    ...payload,
    eventId: suppliedEventId || (options.randomUUID || randomUUID)(),
  };
  const wait = options.sleep || sleep;

  for (
    let attempt = 1;
    attempt <= TERMINAL_EVENT_MAX_PUBLISH_ATTEMPTS;
    attempt += 1
  ) {
    try {
      await publishAttempt(terminalPayload);
      return;
    } catch (error) {
      const canRetry =
        error instanceof WorkflowEventPublishError && error.retryable;
      if (!canRetry || attempt === TERMINAL_EVENT_MAX_PUBLISH_ATTEMPTS) {
        throw error;
      }
      await wait(TERMINAL_EVENT_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }
}
