import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import test from 'node:test';
import {
  createBoundedLocalDockerLogPublisher,
  LOCAL_DOCKER_LOG_LIMITS,
  prepareLocalDockerRunner,
} from './docker-local';

test('serializes and bounds local Docker log publication with one truncation notice', async () => {
  const published: string[] = [];
  let concurrent = 0;
  let maximumConcurrent = 0;
  const publisher = createBoundedLocalDockerLogPublisher({
    publishLog: async (message) => {
      concurrent += 1;
      maximumConcurrent = Math.max(maximumConcurrent, concurrent);
      await new Promise((resolve) => setImmediate(resolve));
      published.push(message);
      concurrent -= 1;
    },
  });

  for (let index = 0; index < LOCAL_DOCKER_LOG_LIMITS.lines * 2; index++) {
    publisher.publish(`line-${index}`, 'info');
  }
  await publisher.drain();

  assert.equal(maximumConcurrent, 1);
  assert.ok(published.length <= LOCAL_DOCKER_LOG_LIMITS.pendingLines + 1);
  assert.equal(
    published.filter((message) => message.includes('Output truncated')).length,
    1,
  );
});

test('applies local Docker log budgets in UTF-8 bytes', async () => {
  const published: string[] = [];
  const publisher = createBoundedLocalDockerLogPublisher({
    publishLog: async (message) => {
      published.push(message);
    },
  });
  const multibyte = '🤖'.repeat(LOCAL_DOCKER_LOG_LIMITS.pendingBytes / 2);
  publisher.publish(multibyte, 'info');
  publisher.publish('after-limit', 'info');
  await publisher.drain();

  assert.deepEqual(published, [
    '[Local Docker] Output truncated after reaching the per-run log publication limit.',
  ]);
});

test('cancellation rejects completion after a graceful exit without a result', async () => {
  let child: ChildProcess | undefined;
  let cleanupCalls = 0;
  let cancelCalls = 0;
  const runner = await prepareLocalDockerRunner<Record<string, unknown>>({
    args: [],
    containerName: 'test-container',
    control: {
      cleanup: async () => {
        cleanupCalls += 1;
      },
      publishCancel: async () => {
        cancelCalls += 1;
      },
      startWithRetry: async () => {},
      waitForCompletion: () => new Promise(() => {}),
      waitUntilReady: async () => {},
    },
    label: 'Test runner',
    nodeId: 'test-node',
    publishLog: async () => {},
    registerActiveProcess: (_nodeId, process) => {
      child = process;
    },
    spawnProcess: ((_command, _args, options) =>
      spawn(process.execPath, ['-e', 'process.exit(0)'], {
        ...options,
        stdio: ['ignore', 'pipe', 'pipe'],
      })) as typeof spawn,
    stopContainer: async () => true,
  });

  assert.ok(child);
  const completion = runner.waitForCompletion();
  await once(child, 'close');
  await runner.cancel?.();

  await assert.rejects(completion, /Test runner was cancelled/);
  await runner.cleanup?.();
  assert.equal(cancelCalls, 1);
  assert.equal(cleanupCalls, 1);
});

test('execution deadline stops a runner even when PID 1 and result polling hang', async () => {
  let child: ChildProcess | undefined;
  let stopCalls = 0;
  const runner = await prepareLocalDockerRunner<Record<string, unknown>>({
    args: [],
    containerName: 'deadline-container',
    control: {
      cleanup: async () => {},
      publishCancel: async () => {},
      startWithRetry: async () => {},
      waitForCompletion: () => new Promise(() => {}),
      waitUntilReady: async () => {},
    },
    executionTimeoutMs: 20,
    label: 'Deadline runner',
    nodeId: 'deadline-node',
    publishLog: async () => {},
    registerActiveProcess: (_nodeId, process) => {
      child = process;
    },
    spawnProcess: ((_command, _args, options) =>
      spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        ...options,
        stdio: ['ignore', 'pipe', 'pipe'],
      })) as typeof spawn,
    stopContainer: async () => {
      stopCalls += 1;
      child?.kill('SIGTERM');
      return true;
    },
  });

  await runner.start();
  await assert.rejects(
    runner.waitForCompletion(),
    /exceeded its execution time limit/,
  );
  assert.equal(stopCalls, 1);
  await runner.cleanup?.();
});
