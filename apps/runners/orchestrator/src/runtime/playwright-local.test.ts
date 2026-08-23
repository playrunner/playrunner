import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalPlaywrightDockerArgs } from './playwright-local';

test('hardens the local Playwright container and runs it as pwuser', () => {
  const args = createLocalPlaywrightDockerArgs({
    containerName: 'playrunner-test',
    cpu: 2,
    executionId: 'execution-1',
    image: 'playwright:test',
    memory: 4,
    nodeId: 'node-1',
    pubSubEmulatorHost: '127.0.0.1:8681',
  });

  assert.ok(args.includes('--pids-limit'));
  assert.ok(args.includes('--cap-drop'));
  assert.ok(args.includes('ALL'));
  assert.ok(args.includes('no-new-privileges'));
  assert.ok(args.includes('nofile=4096:4096'));
  assert.deepEqual(
    args.slice(args.indexOf('--platform'), args.indexOf('--platform') + 2),
    ['--platform', 'linux/amd64'],
  );
  assert.deepEqual(
    args.slice(args.indexOf('--user'), args.indexOf('--user') + 2),
    ['--user', 'pwuser'],
  );
  assert.ok(args.includes('PUBSUB_EMULATOR_HOST=host.docker.internal:8681'));
});
