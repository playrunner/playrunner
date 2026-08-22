import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import {
  verifyRunnerProtocolPayload,
  withRunnerProtocolSignature,
} from '../../../shared/runner-protocol';
import { createPubSubRunnerControlFromSubscriptions } from './pubsub-runner-control';

const originalFetch = globalThis.fetch;
const originalPubSubEmulatorHost = process.env.PUBSUB_EMULATOR_HOST;
const protocolToken = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

beforeEach(() => {
  process.env.PUBSUB_EMULATOR_HOST = '127.0.0.1:8681';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalPubSubEmulatorHost === undefined) {
    delete process.env.PUBSUB_EMULATOR_HOST;
  } else {
    process.env.PUBSUB_EMULATOR_HOST = originalPubSubEmulatorHost;
  }
});

function statusMessage(status: string, ackId: string, error?: string) {
  const payload = withRunnerProtocolSignature(
    {
      ...(error ? { error } : {}),
      executionId: 'execution-1',
      nodeId: 'node-1',
      status,
      type: 'runner_status',
    },
    protocolToken,
  );
  return {
    ackId,
    message: {
      data: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'),
    },
  };
}

function runnerControl() {
  return createPubSubRunnerControlFromSubscriptions({
    accessToken: 'must-not-reach-emulator',
    controlSubscriptionName: 'control-subscription',
    eventSubscriptionName: 'event-subscription',
    executionId: 'execution-1',
    nodeId: 'node-1',
    projectId: 'test-project',
    protocolToken,
    resultSubscriptionName: 'result-subscription',
    statusSubscriptionName: 'status-subscription',
    topicName: 'runner-events',
  });
}

function installFetchBatch(
  messages: Array<ReturnType<typeof statusMessage>>,
): string[][] {
  const acknowledged: string[][] = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    const url = String(input);
    if (url.endsWith(':pull')) {
      return new Response(JSON.stringify({ receivedMessages: messages }), {
        status: 200,
      });
    }
    if (url.endsWith(':acknowledge')) {
      const body = JSON.parse(String(init?.body)) as { ackIds: string[] };
      acknowledged.push(body.ackIds);
    }
    return new Response('{}', { status: 200 });
  };
  return acknowledged;
}

test('terminal failure wins over ready in the same signed status batch', async () => {
  const acknowledged = installFetchBatch([
    statusMessage('ready', 'ready-ack'),
    statusMessage('failed', 'failed-ack', 'runner crashed'),
  ]);
  const control = runnerControl();

  await assert.rejects(control.waitUntilReady(), /runner crashed/);
  assert.deepEqual(acknowledged, [['ready-ack', 'failed-ack']]);
  await control.cleanup();
});

test('terminal cancellation wins over started in the same signed status batch', async () => {
  const acknowledged = installFetchBatch([
    statusMessage('started', 'started-ack'),
    statusMessage('cancelled', 'cancelled-ack'),
  ]);
  const control = runnerControl();

  await assert.rejects(control.startWithRetry(), /reported cancelled/);
  assert.deepEqual(acknowledged, [['started-ack', 'cancelled-ack']]);
  await control.cleanup();
});

test('publishes a signed prepare-only payload while waiting for runner readiness', async () => {
  const published: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith(':publish')) {
      published.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response('{}', { status: 200 });
    }
    if (url.endsWith('status-subscription:pull')) {
      return new Response(
        JSON.stringify({ receivedMessages: [statusMessage('ready', 'ready')] }),
        { status: 200 },
      );
    }
    return new Response('{}', { status: 200 });
  };
  const control = runnerControl();

  await control.waitUntilReadyWithPayload({
    github: { accessToken: 'transported-secret' },
  });

  assert.equal(published.length, 1);
  const message = (published[0].messages as Array<Record<string, unknown>>)[0];
  const attributes = message.attributes as Record<string, unknown>;
  assert.equal(attributes.messageKind, 'runner_control');
  const envelope = JSON.parse(
    Buffer.from(String(message.data), 'base64').toString('utf8'),
  ) as Record<string, unknown>;
  assert.equal(envelope.action, 'start');
  assert.equal(envelope.prepareOnly, true);
  assert.deepEqual(envelope.payload, {
    github: { accessToken: 'transported-secret' },
  });
  assert.equal(verifyRunnerProtocolPayload(envelope, protocolToken), true);
  await control.cleanup();
});

test('keeps the Playwright readiness path free of prepare payload messages', async () => {
  let controlPublishes = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith(':publish')) controlPublishes += 1;
    if (url.endsWith('status-subscription:pull')) {
      return new Response(
        JSON.stringify({ receivedMessages: [statusMessage('ready', 'ready')] }),
        { status: 200 },
      );
    }
    return new Response('{}', { status: 200 });
  };
  const control = runnerControl();

  await control.waitUntilReady();

  assert.equal(controlPublishes, 0);
  await control.cleanup();
});
