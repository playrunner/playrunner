import { executionEvents } from '../services/execution-events';
import type { LogTransport } from './contracts';

function getExecutionId(payload: Record<string, unknown>) {
  if (typeof payload.executionId === 'string' && payload.executionId.trim()) {
    return payload.executionId.trim();
  }

  if (typeof payload.testId === 'string' && payload.testId.trim()) {
    return payload.testId.trim();
  }

  return null;
}

export class DatabaseLogTransport implements LogTransport {
  async publish(payload: string): Promise<void> {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    const executionId = getExecutionId(parsed);

    if (!executionId) {
      throw new Error('Workflow event payload is missing executionId/testId.');
    }

    await executionEvents.appendEvent(executionId, parsed);
  }

  async setup(): Promise<void> {
    // Database-backed event persistence does not require a background subscriber.
  }
}
