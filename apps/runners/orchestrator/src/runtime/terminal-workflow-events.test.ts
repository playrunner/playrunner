import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { executeWorkflow } from '../index';
import {
  publishTerminalWorkflowEvent,
  TERMINAL_EVENT_MAX_PUBLISH_ATTEMPTS,
  TERMINAL_EVENT_RETRY_BASE_DELAY_MS,
  type TerminalWorkflowEventPayload,
  WorkflowEventPublishError,
} from './terminal-workflow-events';

const originalConsoleError = console.error;
const originalFetch = globalThis.fetch;
const originalPubSubEmulatorHost = process.env.PUBSUB_EMULATOR_HOST;

beforeEach(() => {
  console.error = () => undefined;
  process.env.PUBSUB_EMULATOR_HOST = '127.0.0.1:8681';
});

afterEach(() => {
  console.error = originalConsoleError;
  globalThis.fetch = originalFetch;
  if (originalPubSubEmulatorHost === undefined) {
    delete process.env.PUBSUB_EMULATOR_HOST;
  } else {
    process.env.PUBSUB_EMULATOR_HOST = originalPubSubEmulatorHost;
  }
});

function decodeWorkflowEvent(init: RequestInit | undefined) {
  const requestBody = JSON.parse(String(init?.body)) as {
    messages: Array<{ data: string }>;
  };
  return JSON.parse(
    Buffer.from(requestBody.messages[0].data, 'base64').toString('utf8'),
  ) as Record<string, unknown>;
}

function workflowRequest(
  testId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    cloudProvider: 'LOCAL_RUNNER',
    connections: [],
    eventTransport: {
      projectId: 'test-project',
      topicName: 'workflow-events',
      type: 'gcp_pubsub',
    },
    executionAuthToken: 'execution-token',
    nodes: [],
    settings: {},
    testId,
    workflowId: 'workflow-terminal-events',
    ...overrides,
  };
}

describe('terminal workflow event publication', () => {
  test('retries both terminal event types with one stable event id', async () => {
    for (const type of ['workflow_completed', 'workflow_failed'] as const) {
      const eventIds: string[] = [];
      const retryDelays: number[] = [];
      let generatedIds = 0;

      await publishTerminalWorkflowEvent(
        { type },
        async (payload: TerminalWorkflowEventPayload) => {
          eventIds.push(String(payload.eventId));
          if (eventIds.length < TERMINAL_EVENT_MAX_PUBLISH_ATTEMPTS) {
            throw new WorkflowEventPublishError('Transient failure.', {
              retryable: true,
            });
          }
        },
        {
          randomUUID: () => `terminal-event-${++generatedIds}`,
          sleep: async (delayMs) => {
            retryDelays.push(delayMs);
          },
        },
      );

      assert.equal(generatedIds, 1);
      assert.deepEqual(eventIds, [
        'terminal-event-1',
        'terminal-event-1',
        'terminal-event-1',
      ]);
      assert.deepEqual(retryDelays, [
        TERMINAL_EVENT_RETRY_BASE_DELAY_MS,
        TERMINAL_EVENT_RETRY_BASE_DELAY_MS * 2,
      ]);
    }
  });

  test('rejects after the bounded retry count is exhausted', async () => {
    const eventIds: string[] = [];

    await assert.rejects(
      publishTerminalWorkflowEvent(
        { type: 'workflow_failed' },
        async (payload) => {
          eventIds.push(String(payload.eventId));
          throw new WorkflowEventPublishError('Pub/Sub unavailable.', {
            retryable: true,
          });
        },
        {
          randomUUID: () => 'terminal-event-exhausted',
          sleep: async () => undefined,
        },
      ),
      /Pub\/Sub unavailable/,
    );

    assert.equal(eventIds.length, TERMINAL_EVENT_MAX_PUBLISH_ATTEMPTS);
    assert.deepEqual(new Set(eventIds), new Set(['terminal-event-exhausted']));
  });

  test('keeps diagnostics best effort while retrying workflow completion', async () => {
    const publishedEvents: Record<string, unknown>[] = [];
    let completionAttempts = 0;

    globalThis.fetch = async (input, init) => {
      if (!String(input).includes(':publish')) {
        return new Response('{"runs":[]}', { status: 200 });
      }
      const event = decodeWorkflowEvent(init);
      publishedEvents.push(event);
      if (event.type === 'workflow_started') {
        return new Response('diagnostic unavailable', { status: 503 });
      }
      if (event.type === 'workflow_completed') {
        completionAttempts += 1;
        if (completionAttempts === 1) {
          return new Response('temporarily unavailable', { status: 503 });
        }
      }
      return new Response('{}', { status: 200 });
    };

    await executeWorkflow(workflowRequest('terminal-completed-retry'));

    const startedEvents = publishedEvents.filter(
      (event) => event.type === 'workflow_started',
    );
    const completedEvents = publishedEvents.filter(
      (event) => event.type === 'workflow_completed',
    );
    assert.equal(startedEvents.length, 1);
    assert.equal(completedEvents.length, 2);
    assert.equal(completedEvents[0].eventId, completedEvents[1].eventId);
  });

  test('retries workflow failure with one stable event id', async () => {
    const failedEvents: Record<string, unknown>[] = [];

    globalThis.fetch = async (input, init) => {
      if (!String(input).includes(':publish')) {
        return new Response('{"runs":[]}', { status: 200 });
      }
      const event = decodeWorkflowEvent(init);
      if (event.type === 'workflow_failed') {
        failedEvents.push(event);
        if (failedEvents.length === 1) {
          return new Response('temporarily unavailable', { status: 503 });
        }
      }
      return new Response('{}', { status: 200 });
    };

    await assert.rejects(
      executeWorkflow(
        workflowRequest('terminal-failed-retry', {
          nodes: [
            {
              config: {},
              id: 'unsupported-node',
              nodeType: 'unsupported-terminal-test-node',
            },
          ],
        }),
      ),
    );

    assert.equal(failedEvents.length, 2);
    assert.equal(failedEvents[0].eventId, failedEvents[1].eventId);
  });

  test('fails closed without publishing a contradictory terminal event', async () => {
    const terminalEventTypes: unknown[] = [];

    globalThis.fetch = async (input, init) => {
      if (!String(input).includes(':publish')) {
        return new Response('{"runs":[]}', { status: 200 });
      }
      const event = decodeWorkflowEvent(init);
      if (
        event.type === 'workflow_completed' ||
        event.type === 'workflow_failed'
      ) {
        terminalEventTypes.push(event.type);
        return new Response('request rejected', { status: 400 });
      }
      return new Response('{}', { status: 200 });
    };

    await assert.rejects(
      executeWorkflow(workflowRequest('terminal-fail-closed')),
      /Pub\/Sub publish failed \(400\)/,
    );
    assert.deepEqual(terminalEventTypes, ['workflow_completed']);
  });
});
