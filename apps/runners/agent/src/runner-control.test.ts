import assert from 'node:assert/strict';
import test from 'node:test';
import { createRunnerControlClient } from '../../shared/runner-control';
import {
  verifyRunnerProtocolPayload,
  withRunnerProtocolSignature,
} from '../../shared/runner-protocol';

const PROTOCOL_TOKEN = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function response(body: Record<string, unknown> = {}, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function message(payload: Record<string, unknown>, ackId = 'ack-1') {
  return {
    ackId,
    message: {
      data: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'),
    },
  };
}

function client(
  fetcher: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
) {
  return createRunnerControlClient({
    apiBaseUrl: 'http://pubsub.test/v1',
    config: {
      controlSubscriptionName: 'agent-control',
      projectId: 'test-project',
      protocolToken: PROTOCOL_TOKEN,
      topicName: 'workflow-events',
      type: 'gcp_pubsub',
    },
    executionId: 'execution-1',
    fetcher,
    gcpAccessToken: 'gcp-token',
    nodeId: 'agent-node',
    sleep: async () => {},
  });
}

test('waits for a matching start signal and acknowledges pulled messages', async () => {
  const requests: Array<{ body: Record<string, unknown>; url: string }> = [];
  const control = client(async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body || '{}')) as Record<
      string,
      unknown
    >;
    requests.push({ body, url });
    if (url.endsWith(':pull')) {
      return response({
        receivedMessages: [
          message(
            withRunnerProtocolSignature(
              {
                action: 'start',
                executionId: 'another-execution',
                nodeId: 'agent-node',
              },
              PROTOCOL_TOKEN,
            ),
          ),
          message(
            withRunnerProtocolSignature(
              {
                action: 'start',
                executionId: 'execution-1',
                nodeId: 'agent-node',
              },
              'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
            ),
            'ack-spoofed',
          ),
          message(
            withRunnerProtocolSignature(
              {
                action: 'start',
                executionId: 'execution-1',
                nodeId: 'agent-node',
              },
              PROTOCOL_TOKEN,
            ),
            'ack-2',
          ),
        ],
      });
    }
    return response();
  });

  assert.equal(await control.waitForStartSignal(), 'start');
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /agent-control:pull$/);
  assert.deepEqual(requests[1].body, {
    ackIds: ['ack-1', 'ack-spoofed', 'ack-2'],
  });
});

test('returns a matching cancellation signal', async () => {
  const control = client(async (input) => {
    if (String(input).endsWith(':pull')) {
      return response({
        receivedMessages: [
          message(
            withRunnerProtocolSignature(
              {
                action: 'start',
                executionId: 'execution-1',
                nodeId: 'agent-node',
              },
              PROTOCOL_TOKEN,
            ),
          ),
          message(
            withRunnerProtocolSignature(
              {
                action: 'cancel',
                executionId: 'execution-1',
                nodeId: 'agent-node',
              },
              PROTOCOL_TOKEN,
            ),
            'ack-cancel',
          ),
        ],
      });
    }
    return response();
  });

  assert.equal(await control.waitForStartSignal(), 'cancel');
});

test('accepts a signed prepare-only payload and ignores a spoofed envelope', async () => {
  const control = client(async (input) => {
    if (String(input).endsWith(':pull')) {
      return response({
        receivedMessages: [
          message(
            withRunnerProtocolSignature(
              {
                action: 'start',
                executionId: 'execution-1',
                nodeId: 'agent-node',
                payload: { github: { accessToken: 'spoofed' } },
                prepareOnly: true,
              },
              'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
            ),
            'ack-spoofed',
          ),
          message(
            withRunnerProtocolSignature(
              {
                action: 'start',
                executionId: 'execution-1',
                nodeId: 'agent-node',
                payload: { github: { accessToken: 'signed-secret' } },
                prepareOnly: true,
              },
              PROTOCOL_TOKEN,
            ),
            'ack-signed',
          ),
        ],
      });
    }
    return response();
  });

  assert.deepEqual(await control.waitForStartPayload(), {
    action: 'start',
    payload: { github: { accessToken: 'signed-secret' } },
  });
});

test('does not treat a redelivered prepare-only payload as an execution start', async () => {
  let pulls = 0;
  const control = client(async (input) => {
    if (!String(input).endsWith(':pull')) return response();
    pulls += 1;
    return response({
      receivedMessages: [
        message(
          withRunnerProtocolSignature(
            pulls === 1
              ? {
                  action: 'start',
                  executionId: 'execution-1',
                  nodeId: 'agent-node',
                  payload: { config: 'prepare-only' },
                  prepareOnly: true,
                }
              : {
                  action: 'start',
                  executionId: 'execution-1',
                  nodeId: 'agent-node',
                },
            PROTOCOL_TOKEN,
          ),
          `ack-${pulls}`,
        ),
      ],
    });
  });

  assert.equal(await control.waitForStartSignal(), 'start');
  assert.equal(pulls, 2);
});

test('publishes ready and authoritative completed envelopes', async () => {
  const published: Array<Record<string, unknown>> = [];
  const control = client(async (_input, init) => {
    published.push(
      JSON.parse(String(init?.body || '{}')) as Record<string, unknown>,
    );
    return response();
  });

  await control.publishStatus('ready');
  await control.log('Validation attempt 1 of 3.');
  await control.publishStatus('completed', undefined, {
    attempts: 1,
    status: 'passed',
  });

  const readyMessage = (
    published[0].messages as Array<Record<string, unknown>>
  )[0];
  assert.equal(
    (readyMessage.attributes as Record<string, unknown>).messageKind,
    'runner_status',
  );
  const resultMessage = (
    published[2].messages as Array<Record<string, unknown>>
  )[0];
  const resultAttributes = resultMessage.attributes as Record<string, unknown>;
  assert.equal(resultAttributes.messageKind, 'runner_result');
  assert.equal(resultAttributes.executionId, 'execution-1');
  assert.equal(resultAttributes.nodeId, 'agent-node');
  assert.equal(resultMessage.orderingKey, 'execution-1:agent-node');
  const resultPayload = JSON.parse(
    Buffer.from(String(resultMessage.data), 'base64').toString('utf8'),
  ) as Record<string, unknown>;
  assert.equal(resultPayload.status, 'completed');
  assert.equal(resultPayload.executionAuthToken, undefined);
  assert.equal(
    verifyRunnerProtocolPayload(resultPayload, PROTOCOL_TOKEN),
    true,
  );
  assert.deepEqual(resultPayload.output, { attempts: 1, status: 'passed' });
  assert.equal(
    (resultPayload.diagnosticLogs as Array<Record<string, unknown>>).length,
    1,
  );
});

test('publishes child workflow events without changing parent control identity', async () => {
  const published: Array<Record<string, unknown>> = [];
  const control = createRunnerControlClient({
    apiBaseUrl: 'http://pubsub.test/v1',
    config: {
      controlSubscriptionName: 'agent-control',
      projectId: 'test-project',
      protocolToken: PROTOCOL_TOKEN,
      topicName: 'workflow-events',
      type: 'gcp_pubsub',
    },
    executionId: 'execution-1',
    fetcher: async (_input, init) => {
      published.push(
        JSON.parse(String(init?.body || '{}')) as Record<string, unknown>,
      );
      return response();
    },
    nodeId: 'container-parent',
    workflowEventAttributes: { cloudProvider: 'LOCAL_RUNNER' },
    workflowEventFields: { childKind: 'validator' },
  });

  await control.publishNodeState('running', {
    nodeId: 'validator-child',
    parentNodeId: 'container-parent',
  });
  await control.publishEvent(
    {
      executionAuthToken: 'attacker-token',
      executionId: 'attacker-execution',
      nodeId: 'attacker-node',
      testId: 'attacker-test',
      type: 'custom_event',
    },
    {
      nodeId: 'validator-child',
      parentNodeId: 'container-parent',
    },
  );

  const eventMessage = (
    published[0].messages as Array<Record<string, unknown>>
  )[0];
  const attributes = eventMessage.attributes as Record<string, unknown>;
  assert.equal(attributes.messageKind, 'runner_event');
  assert.equal(attributes.nodeId, 'validator-child');
  assert.equal(attributes.cloudProvider, 'LOCAL_RUNNER');
  assert.equal(eventMessage.orderingKey, 'execution-1');
  const event = JSON.parse(
    Buffer.from(String(eventMessage.data), 'base64').toString('utf8'),
  ) as Record<string, unknown>;
  assert.equal(event.nodeId, 'validator-child');
  assert.equal(event.parentNodeId, 'container-parent');
  assert.equal(event.childKind, 'validator');
  assert.equal(event.executionAuthToken, undefined);
  assert.equal(event.runnerNodeId, 'container-parent');
  assert.equal(verifyRunnerProtocolPayload(event, PROTOCOL_TOKEN), true);

  const customMessage = (
    published[1].messages as Array<Record<string, unknown>>
  )[0];
  const customEvent = JSON.parse(
    Buffer.from(String(customMessage.data), 'base64').toString('utf8'),
  ) as Record<string, unknown>;
  assert.equal(customEvent.executionAuthToken, undefined);
  assert.equal(customEvent.executionId, 'execution-1');
  assert.equal(customEvent.nodeId, 'validator-child');
  assert.equal(customEvent.testId, 'execution-1');
});

test('fails closed when a critical child node-state event cannot publish', async () => {
  const control = client(async () => response({ error: 'unavailable' }, 400));

  await assert.rejects(
    () =>
      control.publishNodeState('running', {
        nodeId: 'validator-child',
        parentNodeId: 'agent-node',
      }),
    /Pub\/Sub API returned 400/,
  );
});

test('keeps diagnostic log publication best effort', async () => {
  const control = client(async () => response({ error: 'unavailable' }, 400));

  await control.log('diagnostic only');
});

test('does not reuse a sequence after an ambiguously failed diagnostic publish', async () => {
  const attemptedEvents: Array<Record<string, unknown>> = [];
  const control = client(async (_input, init) => {
    const request = JSON.parse(String(init?.body || '{}')) as {
      messages?: Array<{ data?: string }>;
    };
    const encoded = request.messages?.[0]?.data;
    if (encoded) {
      attemptedEvents.push(
        JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as Record<
          string,
          unknown
        >,
      );
    }
    throw new Error('publish response was lost');
  });

  await control.log('accepted but response lost');
  await assert.rejects(
    () =>
      control.publishNodeState('running', {
        nodeId: 'validator-child',
        parentNodeId: 'agent-node',
      }),
    /publish response was lost/,
  );

  assert.equal(attemptedEvents.length, 3);
  assert.deepEqual(
    attemptedEvents.map((event) => event.runnerEventSequence),
    [1, 1, 1],
  );
});
