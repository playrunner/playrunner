import assert from 'node:assert/strict';
import test from 'node:test';
import { ExecutionControl } from './execution-control';
import { executeWorkflow, stopWorkflow, executionControl } from '../index';
import { orchestratorRuntime } from './index';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
test('tracks preparation and cleanup; stopping one execution cannot affect another', async () => {
  const control = new ExecutionControl();
  const finish = deferred<void>();
  const a = control.run('a', async (signal) => {
    await finish.promise;
    assert.equal(signal.aborted, true);
  });
  const b = control.run('b', async (signal) => {
    await finish.promise;
    assert.equal(signal.aborted, false);
  });
  assert.equal(control.status('a'), 'running');
  assert.equal(control.stop('a'), 'stopping');
  assert.equal(control.status('b'), 'running');
  finish.resolve();
  await Promise.all([a, b]);
  assert.equal(control.status('a'), 'absent');
});

test('a stop that arrives before execution prevents a late launch', async () => {
  const control = new ExecutionControl();
  assert.equal(control.stop('queued'), 'absent');
  let launched = false;
  await assert.rejects(
    control.run('queued', async () => {
      launched = true;
    }),
    /stopped before/,
  );
  assert.equal(launched, false);
});

test('whole-run cancellation stops the current runner and prevents downstream nodes', async (t) => {
  const events: Record<string, unknown>[] = [];
  const started = deferred<void>();
  const finished = deferred<{ outcome: 'success'; output: object }>();
  const priorHost = process.env.PUBSUB_EMULATOR_HOST;
  const priorApi = process.env.EDITOR_API_URL;
  process.env.EDITOR_API_URL = 'http://127.0.0.1:3999';
  process.env.PUBSUB_EMULATOR_HOST = '127.0.0.1:8681';
  t.after(() => {
    if (priorApi === undefined) delete process.env.EDITOR_API_URL;
    else process.env.EDITOR_API_URL = priorApi;
    if (priorHost === undefined) delete process.env.PUBSUB_EMULATOR_HOST;
    else process.env.PUBSUB_EMULATOR_HOST = priorHost;
  });
  t.mock.method(
    globalThis,
    'fetch',
    async (_url: unknown, init?: RequestInit) => {
      if (init?.body) {
        const body = JSON.parse(String(init.body));
        for (const message of body.messages ?? [])
          events.push(
            JSON.parse(Buffer.from(message.data, 'base64').toString()),
          );
      }
      return new Response('{}');
    },
  );
  let cancelled = 0;
  t.mock.method(
    orchestratorRuntime.playwrightExecution,
    'prepare',
    async () => ({
      start: async () => {
        started.resolve();
      },
      waitUntilReady: async () => {},
      waitForCompletion: () => finished.promise,
      cancel: async () => {
        cancelled++;
        finished.reject(new Error('cancelled'));
      },
      cleanup: async () => {},
    }),
  );
  const id = 'cancel-whole-workflow';
  const request = {
    testId: id,
    executionAuthToken: 'test-execution-token',
    cloudProvider: 'GCP',
    settings: {},
    eventTransport: {
      type: 'gcp_pubsub',
      projectId: 'test',
      topicName: 'events',
    },
    nodes: [
      {
        id: 'tests',
        nodeType: 'playwright',
        label: 'Tests',
        config: { sharding: { mode: 'off' } },
      },
      {
        id: 'next',
        nodeType: 'code',
        label: 'Must not start',
        config: { code: 'return {};' },
      },
    ],
    connections: [{ sourceId: 'tests', targetId: 'next', type: 'sequential' }],
  };
  const running = executeWorkflow(request);
  await started.promise;
  assert.equal(executionControl.status(id), 'running');
  await stopWorkflow(id);
  await running;
  assert.equal(cancelled, 1);
  assert.equal(executionControl.status(id), 'absent');
  assert.ok(events.some((event) => event.type === 'workflow_cancelled'));
  assert.ok(
    !events.some(
      (event) => event.nodeId === 'next' && event.state === 'running',
    ),
  );
  assert.ok(!events.some((event) => event.type === 'workflow_completed'));

  events.length = 0;
  const preparing = deferred<void>();
  const releasePreparation = deferred<void>();
  let lateStarts = 0;
  let lateCancelled = false;
  t.mock.method(
    orchestratorRuntime.playwrightExecution,
    'prepare',
    async () => {
      preparing.resolve();
      await releasePreparation.promise;
      return {
        start: async () => {
          lateStarts++;
        },
        waitUntilReady: async () => {},
        waitForCompletion: async () => ({
          outcome: 'success' as const,
          output: {},
        }),
        cancel: async () => {
          lateCancelled = true;
        },
        cleanup: async () => {},
      };
    },
  );
  const lateId = 'cancel-during-preparation';
  const lateRun = executeWorkflow({ ...request, testId: lateId });
  await preparing.promise;
  await stopWorkflow(lateId);
  assert.equal(executionControl.status(lateId), 'stopping');
  assert.ok(!events.some((event) => event.type === 'workflow_cancelled'));
  releasePreparation.resolve();
  await lateRun;
  assert.equal(lateStarts, 0);
  assert.equal(lateCancelled, true);
  assert.ok(events.some((event) => event.type === 'workflow_cancelled'));
});
