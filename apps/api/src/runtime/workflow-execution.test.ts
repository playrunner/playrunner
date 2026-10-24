import assert from 'node:assert/strict';
import test from 'node:test';
import { localStartFailurePolicy } from './workflow-execution';

test('local runner start failures preserve ambiguous invocations', () => {
  assert.deepEqual(localStartFailurePolicy(false), {
    cleanupEventTransport: false,
    eventType: 'log',
    httpStatus: 202,
  });
});

test('local runner setup failures and HTTP rejections are terminal', () => {
  assert.deepEqual(localStartFailurePolicy(true), {
    cleanupEventTransport: true,
    eventType: 'workflow_failed',
    httpStatus: 500,
  });
});

test('unavailable message transport fails before dispatch and persists an actionable safe event', async (t) => {
  const { LocalWorkflowExecutionBackend } =
    await import('./workflow-execution');
  const { executionEvents, toSafeWorkflowEvent } =
    await import('../services/execution-events');
  t.mock.method(executionEvents, 'createExecution', async () => ({
    executionToken: 'test-token',
  }));
  const events: Record<string, unknown>[] = [];
  let dispatches = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    dispatches++;
    throw new Error('Unexpected dispatch');
  });
  const backend = new LocalWorkflowExecutionBackend(
    {
      setup: async () => {},
      publish: async (payload) => {
        events.push(JSON.parse(payload));
      },
    },
    {
      ensureGcpPubSubEventStream: async () => {
        throw new TypeError('http://private:secret@internal', {
          cause: Object.assign(new Error('private'), { code: 'ECONNREFUSED' }),
        });
      },
    } as never,
    async () => ({ ok: true, message: 'ready' }),
  );
  const response = await backend.execute({
    body: { workflowId: 'workflow' },
    testId: 'execution',
    req: { authUser: { providerUserId: 'owner' } } as never,
  });
  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'LOCAL_EVENT_SERVICE_UNAVAILABLE');
  assert.equal(response.body.reason, 'connection_refused');
  assert.match(response.body.error, /refused the connection/);
  assert.equal(response.body.testId, 'execution');
  assert.match(response.body.error, /workflow has not started/);
  assert.equal(dispatches, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'workflow_failed');
  const safeEvent = toSafeWorkflowEvent({ sequence: 1n, payload: events[0] });
  assert.match(safeEvent.message!, /message service/);
  assert.doesNotMatch(
    JSON.stringify({ response, events, safeEvent }),
    /private|secret|internal/,
  );
});
