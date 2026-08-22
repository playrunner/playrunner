import crypto from 'crypto';
import {
  createRunnerProtocolToken,
  MAX_RUNNER_PROTOCOL_PAYLOAD_BYTES,
  verifyRunnerProtocolPayload,
  withRunnerProtocolSignature,
} from '../../../shared/runner-protocol';

type PubSubPullResponse = {
  receivedMessages?: Array<{
    ackId: string;
    message: {
      data?: string;
    };
  }>;
};

type PubSubSubscription = {
  enableMessageOrdering?: boolean;
  filter?: string;
  topic?: string;
};

export type PubSubRunnerControl = {
  cleanup: () => Promise<void>;
  payload: {
    controlSubscriptionName: string;
    projectId: string;
    protocolToken: string;
    topicName: string;
    type: 'gcp_pubsub';
  };
  eventSubscriptionName: string;
  publishCancel: () => Promise<void>;
  publishStart: () => Promise<void>;
  startWithRetry: () => Promise<void>;
  waitForCompletion: () => Promise<{
    diagnosticLogs?: Array<{
      level: 'info' | 'error';
      message: string;
      nodeId?: string;
      timestamp: string;
    }>;
    outcome: 'success' | 'error';
    output: Record<string, unknown>;
  }>;
  statusSubscriptionName: string;
  waitUntilReady: () => Promise<void>;
  waitUntilReadyWithPayload: (
    payload: Record<string, unknown>,
  ) => Promise<void>;
};

const PUBSUB_API_BASE_URL = 'https://pubsub.googleapis.com/v1';
const MAX_TRANSIENT_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 1000;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const RUNNER_CONTROL_ACK_DEADLINE_SECONDS = 60;
// GCP Pub/Sub minimum subscription expiration TTL is 24 hours.
const RUNNER_CONTROL_RETENTION_SECONDS = 24 * 60 * 60;
const RUNNER_READY_TIMEOUT_MS = 30 * 60 * 1000;
const RUNNER_COMPLETION_TIMEOUT_MS = 25 * 60 * 60 * 1000;
const RUNNER_START_CONFIRM_TIMEOUT_MS = 30 * 60 * 1000;
const RUNNER_START_RETRY_INTERVAL_MS = 3000;
const RUNNER_STATUS_POLL_INTERVAL_MS = 1000;
const RUNNER_EVENT_BARRIER_TIMEOUT_MS = 30_000;
const PUBSUB_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_WORKFLOW_EVENTS_TOPIC = 'playrunner-workflow-events';

export function createPubSubAuthorizationHeaders(
  apiBaseUrl: string,
  accessToken: string | undefined,
): Record<string, string> {
  return apiBaseUrl === PUBSUB_API_BASE_URL && accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : {};
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sanitizePubSubId(value: string, fallback: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9._~%+-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 255);

  return sanitized || fallback;
}

function getPubSubApiBaseUrl(): string {
  const emulatorHost = process.env.PUBSUB_EMULATOR_HOST?.trim();
  if (!emulatorHost) {
    return PUBSUB_API_BASE_URL;
  }

  const normalizedHost = emulatorHost.replace(/\/+$/, '');
  return `${normalizedHost.startsWith('http') ? normalizedHost : `http://${normalizedHost}`}/v1`;
}

function isUsingPubSubEmulator(): boolean {
  return !!process.env.PUBSUB_EMULATOR_HOST?.trim();
}

function getRunnerControlSubscriptionName(args: {
  executionId: string;
  nodeId: string;
}) {
  return sanitizePubSubId(
    `playrunner-runner-control-${args.executionId}-${args.nodeId}`,
    `playrunner-runner-control-${Date.now()}`,
  );
}

function getRunnerStatusSubscriptionName(args: {
  executionId: string;
  nodeId: string;
}) {
  return sanitizePubSubId(
    `playrunner-runner-status-${args.executionId}-${args.nodeId}`,
    `playrunner-runner-status-${Date.now()}`,
  );
}

function getRunnerResultSubscriptionName(args: {
  executionId: string;
  nodeId: string;
}) {
  return sanitizePubSubId(
    `playrunner-runner-result-${args.executionId}-${args.nodeId}`,
    `playrunner-runner-result-${Date.now()}`,
  );
}

function getRunnerEventSubscriptionName(args: {
  executionId: string;
  nodeId: string;
}) {
  return sanitizePubSubId(
    `playrunner-runner-event-${args.executionId}-${args.nodeId}`,
    `playrunner-runner-event-${Date.now()}`,
  );
}

async function pubSubRequest<T>(
  resourcePath: string,
  accessToken: string | undefined,
  init: RequestInit = {},
): Promise<T> {
  if (!accessToken && !isUsingPubSubEmulator()) {
    throw new Error('Pub/Sub access token is required.');
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
    let response: Response;
    try {
      const apiBaseUrl = getPubSubApiBaseUrl();
      response = await fetch(`${apiBaseUrl}/${resourcePath}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...createPubSubAuthorizationHeaders(apiBaseUrl, accessToken),
          ...(init.headers || {}),
        },
        signal: init.signal || AbortSignal.timeout(PUBSUB_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      lastError = error;
      if (attempt === MAX_TRANSIENT_RETRIES) {
        throw error;
      }
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
      continue;
    }

    if (!response.ok) {
      const details = await response.text().catch(() => '');
      if (
        RETRYABLE_STATUS_CODES.has(response.status) &&
        attempt < MAX_TRANSIENT_RETRIES
      ) {
        lastError = new Error(
          `Pub/Sub API returned ${response.status}: ${details}`,
        );
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      throw new Error(`Pub/Sub API returned ${response.status}: ${details}`);
    }

    if (response.status === 204) {
      return {} as T;
    }

    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Pub/Sub API request failed after retries.');
}

async function ensurePubSubTopic(args: {
  accessToken?: string;
  projectId: string;
  topicName: string;
}) {
  try {
    await pubSubRequest(
      `projects/${args.projectId}/topics/${args.topicName}`,
      args.accessToken,
      { method: 'GET' },
    );
    return;
  } catch (error: any) {
    if (!error.message?.includes('Pub/Sub API returned 404')) {
      throw error;
    }
  }

  try {
    await pubSubRequest(
      `projects/${args.projectId}/topics/${args.topicName}`,
      args.accessToken,
      {
        body: JSON.stringify({}),
        method: 'PUT',
      },
    );
  } catch (error: any) {
    if (!error.message?.includes('Pub/Sub API returned 409')) {
      throw error;
    }
  }
}

async function ensureRunnerSubscription(args: {
  accessToken?: string;
  filter: string;
  projectId: string;
  subscriptionName: string;
  topicName: string;
}) {
  try {
    await pubSubRequest(
      `projects/${args.projectId}/subscriptions/${args.subscriptionName}`,
      args.accessToken,
      {
        body: JSON.stringify({
          ackDeadlineSeconds: RUNNER_CONTROL_ACK_DEADLINE_SECONDS,
          enableMessageOrdering: true,
          expirationPolicy: {
            ttl: `${RUNNER_CONTROL_RETENTION_SECONDS}s`,
          },
          filter: args.filter,
          messageRetentionDuration: `${RUNNER_CONTROL_RETENTION_SECONDS}s`,
          topic: `projects/${args.projectId}/topics/${args.topicName}`,
        }),
        method: 'PUT',
      },
    );
  } catch (error: any) {
    if (!error.message?.includes('Pub/Sub API returned 409')) {
      throw error;
    }

    const existing = await pubSubRequest<PubSubSubscription>(
      `projects/${args.projectId}/subscriptions/${args.subscriptionName}`,
      args.accessToken,
      { method: 'GET' },
    );
    const expectedTopic = `projects/${args.projectId}/topics/${args.topicName}`;
    if (
      existing.topic !== expectedTopic ||
      existing.filter !== args.filter ||
      existing.enableMessageOrdering !== true
    ) {
      throw new Error(
        `Existing runner subscription ${args.subscriptionName} has an incompatible topic or filter.`,
      );
    }
  }
}

async function deleteRunnerSubscription(args: {
  accessToken?: string;
  projectId: string;
  subscriptionName: string;
}) {
  try {
    await pubSubRequest(
      `projects/${args.projectId}/subscriptions/${args.subscriptionName}`,
      args.accessToken,
      { method: 'DELETE' },
    );
  } catch (error: any) {
    if (!error.message?.includes('Pub/Sub API returned 404')) {
      console.warn(
        `Failed to delete runner subscription ${args.subscriptionName}: ${error.message}`,
      );
    }
  }
}

async function publishRunnerControlMessage(args: {
  accessToken?: string;
  action: 'cancel' | 'start';
  executionId: string;
  nodeId: string;
  projectId: string;
  protocolToken: string;
  payload?: Record<string, unknown>;
  prepareOnly?: true;
  topicName: string;
}) {
  if (Boolean(args.payload) !== Boolean(args.prepareOnly)) {
    throw new Error(
      'Runner bootstrap control messages require both payload and prepareOnly.',
    );
  }
  const eventId = crypto.randomUUID();
  const payload = withRunnerProtocolSignature(
    {
      action: args.action,
      eventId,
      executionId: args.executionId,
      nodeId: args.nodeId,
      ...(args.payload ? { payload: args.payload, prepareOnly: true } : {}),
      testId: args.executionId,
      timestamp: new Date().toISOString(),
      type: 'runner_control',
    },
    args.protocolToken,
  );

  await pubSubRequest(
    `projects/${args.projectId}/topics/${args.topicName}:publish`,
    args.accessToken,
    {
      body: JSON.stringify({
        messages: [
          {
            attributes: {
              eventId,
              eventType: 'runner_control',
              executionId: args.executionId,
              messageKind: 'runner_control',
              nodeId: args.nodeId,
            },
            data: Buffer.from(JSON.stringify(payload), 'utf8').toString(
              'base64',
            ),
            orderingKey: `${args.executionId}:${args.nodeId}`,
          },
        ],
      }),
      method: 'POST',
    },
  );
}

function decodePubSubPayload(message: { data?: string }): Record<string, any> {
  if (!message.data) {
    return {};
  }
  if (
    message.data.length >
    Math.ceil((MAX_RUNNER_PROTOCOL_PAYLOAD_BYTES * 4) / 3) + 4
  ) {
    throw new Error('Runner protocol payload is too large.');
  }
  const decoded = Buffer.from(message.data, 'base64');
  if (decoded.length > MAX_RUNNER_PROTOCOL_PAYLOAD_BYTES) {
    throw new Error('Runner protocol payload is too large.');
  }
  const parsed: unknown = JSON.parse(decoded.toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Runner protocol payload must be an object.');
  }
  return parsed as Record<string, any>;
}

function decodeAuthenticatedRunnerPayload(
  message: { data?: string },
  expected: { executionId: string; nodeId: string; protocolToken: string },
): Record<string, any> | null {
  let payload: Record<string, any>;
  try {
    payload = decodePubSubPayload(message);
    if (
      payload.executionId !== expected.executionId ||
      payload.nodeId !== expected.nodeId ||
      !verifyRunnerProtocolPayload(payload, expected.protocolToken)
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return payload;
}

function decodeAuthenticatedRunnerEvent(
  message: { data?: string },
  expected: { executionId: string; nodeId: string; protocolToken: string },
): Record<string, unknown> | null {
  let payload: Record<string, any>;
  try {
    payload = decodePubSubPayload(message);
    if (
      payload.executionId !== expected.executionId ||
      payload.runnerNodeId !== expected.nodeId ||
      !verifyRunnerProtocolPayload(payload, expected.protocolToken)
    ) {
      return null;
    }
  } catch {
    return null;
  }
  const { protocolSignature: _protocolSignature, ...event } = payload;
  return event;
}

type RunnerEventPump = {
  stop: () => void;
  waitUntilSequence: (sequence: number) => Promise<void>;
};

function startRunnerEventPump(args: {
  accessToken?: string;
  executionId: string;
  nodeId: string;
  onRunnerEvent?: (event: Record<string, unknown>) => Promise<void>;
  projectId: string;
  protocolToken: string;
  subscriptionName: string;
}): RunnerEventPump {
  let stopped = false;
  let handledSequence = 0;
  if (!args.onRunnerEvent) {
    return {
      stop: () => undefined,
      waitUntilSequence: async () => undefined,
    };
  }

  const run = async () => {
    while (!stopped) {
      let response: PubSubPullResponse;
      try {
        response = await pullRunnerStatusMessages(args);
      } catch (error) {
        if (stopped) return;
        console.warn(
          `Failed to pull signed runner events for ${args.nodeId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        await sleep(RUNNER_STATUS_POLL_INTERVAL_MS);
        continue;
      }
      if (stopped) return;
      const messages = response.receivedMessages || [];
      const ackIds: string[] = [];
      const nackIds: string[] = [];
      let sequenceBlocked = false;
      for (const message of messages) {
        if (sequenceBlocked) {
          nackIds.push(message.ackId);
          continue;
        }
        const event = decodeAuthenticatedRunnerEvent(message.message, args);
        if (!event) {
          ackIds.push(message.ackId);
          continue;
        }
        const sequence = Number(event.runnerEventSequence);
        if (!Number.isSafeInteger(sequence) || sequence < 1) {
          ackIds.push(message.ackId);
          continue;
        }
        if (sequence <= handledSequence) {
          ackIds.push(message.ackId);
          continue;
        }
        if (sequence !== handledSequence + 1) {
          nackIds.push(message.ackId);
          sequenceBlocked = true;
          continue;
        }
        try {
          await args.onRunnerEvent(event);
          handledSequence = sequence;
          ackIds.push(message.ackId);
        } catch (error) {
          nackIds.push(message.ackId);
          sequenceBlocked = true;
          console.warn(
            `Failed to handle signed runner event for ${args.nodeId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      await acknowledgeRunnerStatusMessages({ ...args, ackIds }).catch(
        (error) => {
          if (!stopped) {
            console.warn(
              `Failed to acknowledge signed runner events for ${args.nodeId}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        },
      );
      await nackRunnerMessages({ ...args, ackIds: nackIds }).catch((error) => {
        if (!stopped) {
          console.warn(
            `Failed to nack signed runner events for ${args.nodeId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      });
      if (!messages.length) await sleep(RUNNER_STATUS_POLL_INTERVAL_MS);
    }
  };
  void run().catch((error) => {
    if (!stopped) {
      console.warn(
        `Signed runner event pump failed for ${args.nodeId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  return {
    stop: () => {
      stopped = true;
    },
    waitUntilSequence: async (sequence) => {
      const startedAt = Date.now();
      while (
        handledSequence < sequence &&
        Date.now() - startedAt < RUNNER_EVENT_BARRIER_TIMEOUT_MS
      ) {
        await sleep(50);
      }
      if (handledSequence < sequence) {
        throw new Error(
          `Timed out relaying signed runner events through sequence ${sequence} for ${args.nodeId}.`,
        );
      }
    },
  };
}

async function pullRunnerStatusMessages(args: {
  accessToken?: string;
  projectId: string;
  subscriptionName: string;
}) {
  return pubSubRequest<PubSubPullResponse>(
    `projects/${args.projectId}/subscriptions/${args.subscriptionName}:pull`,
    args.accessToken,
    {
      body: JSON.stringify({ maxMessages: 10, returnImmediately: true }),
      method: 'POST',
    },
  );
}

async function acknowledgeRunnerStatusMessages(args: {
  accessToken?: string;
  ackIds: string[];
  projectId: string;
  subscriptionName: string;
}) {
  if (args.ackIds.length === 0) {
    return;
  }
  await pubSubRequest(
    `projects/${args.projectId}/subscriptions/${args.subscriptionName}:acknowledge`,
    args.accessToken,
    {
      body: JSON.stringify({ ackIds: args.ackIds }),
      method: 'POST',
    },
  );
}

async function nackRunnerMessages(args: {
  accessToken?: string;
  ackIds: string[];
  projectId: string;
  subscriptionName: string;
}) {
  if (args.ackIds.length === 0) return;
  await pubSubRequest(
    `projects/${args.projectId}/subscriptions/${args.subscriptionName}:modifyAckDeadline`,
    args.accessToken,
    {
      body: JSON.stringify({ ackDeadlineSeconds: 0, ackIds: args.ackIds }),
      method: 'POST',
    },
  );
}

async function waitForRunnerReady(args: {
  accessToken?: string;
  executionId: string;
  nodeId: string;
  projectId: string;
  protocolToken: string;
  publishPrepare?: () => Promise<void>;
  subscriptionName: string;
  waitForEventSequence?: (sequence: number) => Promise<void>;
  timeoutMs?: number;
}) {
  const startedAt = Date.now();
  let lastPreparePublishedAt = 0;

  while (Date.now() - startedAt < (args.timeoutMs || RUNNER_READY_TIMEOUT_MS)) {
    if (
      args.publishPrepare &&
      (!lastPreparePublishedAt ||
        Date.now() - lastPreparePublishedAt >= RUNNER_START_RETRY_INTERVAL_MS)
    ) {
      await args.publishPrepare();
      lastPreparePublishedAt = Date.now();
    }
    const response = await pullRunnerStatusMessages(args);
    const messages = response.receivedMessages || [];
    const ackIds = messages.map((message) => message.ackId);
    let ready = false;
    let terminal: Record<string, any> | undefined;
    for (const message of messages) {
      const payload = decodeAuthenticatedRunnerPayload(message.message, args);
      if (!payload) continue;
      if (
        payload.status === 'cancelled' ||
        payload.status === 'prepare_failed' ||
        payload.status === 'failed'
      ) {
        terminal = payload;
      } else if (payload.status === 'ready' || payload.status === 'started') {
        ready = true;
      }
    }
    await acknowledgeRunnerStatusMessages({
      ...args,
      ackIds,
    });
    if (terminal) {
      await args.waitForEventSequence?.(
        Number.isSafeInteger(terminal.lastRunnerEventSequence)
          ? terminal.lastRunnerEventSequence
          : 0,
      );
      throw new Error(
        terminal.error ||
          `Prepared Playwright runner reported ${terminal.status}.`,
      );
    }
    if (ready) return;

    await sleep(RUNNER_STATUS_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for prepared Playwright runner ${args.nodeId}.`,
  );
}

async function waitForRunnerStarted(args: {
  accessToken?: string;
  executionId: string;
  nodeId: string;
  projectId: string;
  protocolToken: string;
  publishStart: () => Promise<void>;
  subscriptionName: string;
  waitForEventSequence?: (sequence: number) => Promise<void>;
}) {
  const startedAt = Date.now();
  let lastStartPublishedAt = 0;

  while (Date.now() - startedAt < RUNNER_START_CONFIRM_TIMEOUT_MS) {
    if (
      !lastStartPublishedAt ||
      Date.now() - lastStartPublishedAt >= RUNNER_START_RETRY_INTERVAL_MS
    ) {
      await args.publishStart();
      lastStartPublishedAt = Date.now();
    }

    const response = await pullRunnerStatusMessages(args);
    const messages = response.receivedMessages || [];
    const ackIds = messages.map((message) => message.ackId);
    let runnerStarted = false;
    let terminal: Record<string, any> | undefined;
    for (const message of messages) {
      const payload = decodeAuthenticatedRunnerPayload(message.message, args);
      if (!payload) continue;
      if (
        payload.status === 'cancelled' ||
        payload.status === 'prepare_failed' ||
        payload.status === 'failed'
      ) {
        terminal = payload;
      } else if (payload.status === 'started') {
        runnerStarted = true;
      }
    }
    await acknowledgeRunnerStatusMessages({
      ...args,
      ackIds,
    });
    if (terminal) {
      await args.waitForEventSequence?.(
        Number.isSafeInteger(terminal.lastRunnerEventSequence)
          ? terminal.lastRunnerEventSequence
          : 0,
      );
      throw new Error(
        terminal.error ||
          `Prepared Playwright runner reported ${terminal.status}.`,
      );
    }
    if (runnerStarted) return;

    await sleep(RUNNER_STATUS_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for prepared Playwright runner ${args.nodeId} to acknowledge start.`,
  );
}

async function waitForRunnerCompletion(args: {
  accessToken?: string;
  executionId: string;
  nodeId: string;
  projectId: string;
  protocolToken: string;
  subscriptionName: string;
}): Promise<{
  diagnosticLogs?: Array<{
    level: 'info' | 'error';
    message: string;
    nodeId?: string;
    timestamp: string;
  }>;
  outcome: 'success' | 'error';
  output: Record<string, unknown>;
  lastRunnerEventSequence: number;
}> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < RUNNER_COMPLETION_TIMEOUT_MS) {
    const response = await pullRunnerStatusMessages(args);
    const messages = response.receivedMessages || [];
    const ackIds = messages.map((message) => message.ackId);

    try {
      for (const message of messages) {
        const payload = decodeAuthenticatedRunnerPayload(message.message, args);
        if (!payload || payload.status !== 'completed') {
          continue;
        }

        return {
          diagnosticLogs: Array.isArray(payload.diagnosticLogs)
            ? payload.diagnosticLogs
            : undefined,
          outcome: payload.error ? 'error' : 'success',
          output:
            payload.output && typeof payload.output === 'object'
              ? payload.output
              : {},
          lastRunnerEventSequence: Number.isSafeInteger(
            payload.lastRunnerEventSequence,
          )
            ? payload.lastRunnerEventSequence
            : 0,
        };
      }
    } finally {
      await acknowledgeRunnerStatusMessages({
        ...args,
        ackIds,
      });
    }

    await sleep(RUNNER_STATUS_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for prepared Playwright runner ${args.nodeId} to report completion.`,
  );
}

export function resolveWorkflowEventsTopicName(value: unknown): string {
  return sanitizePubSubId(
    typeof value === 'string' && value.trim()
      ? value
      : process.env.GCP_PUBSUB_WORKFLOW_EVENTS_TOPIC ||
          DEFAULT_WORKFLOW_EVENTS_TOPIC,
    DEFAULT_WORKFLOW_EVENTS_TOPIC,
  );
}

export async function createPubSubRunnerControl(args: {
  accessToken?: string;
  executionId: string;
  nodeId: string;
  onRunnerEvent?: (event: Record<string, unknown>) => Promise<void>;
  projectId: string;
  runnerReadyTimeoutMs?: number;
  topicName: string;
}): Promise<PubSubRunnerControl> {
  const controlSubscriptionName = getRunnerControlSubscriptionName(args);
  const statusSubscriptionName = getRunnerStatusSubscriptionName(args);
  const resultSubscriptionName = getRunnerResultSubscriptionName(args);
  const eventSubscriptionName = getRunnerEventSubscriptionName(args);
  const protocolToken = createRunnerProtocolToken();

  await ensurePubSubTopic(args);
  const subscriptions = [
    {
      filter: `attributes.executionId = "${args.executionId}" AND attributes.nodeId = "${args.nodeId}" AND attributes.messageKind = "runner_control"`,
      subscriptionName: controlSubscriptionName,
    },
    {
      filter: `attributes.executionId = "${args.executionId}" AND attributes.nodeId = "${args.nodeId}" AND attributes.messageKind = "runner_status"`,
      subscriptionName: statusSubscriptionName,
    },
    {
      filter: `attributes.executionId = "${args.executionId}" AND attributes.nodeId = "${args.nodeId}" AND attributes.messageKind = "runner_result"`,
      subscriptionName: resultSubscriptionName,
    },
    {
      filter: `attributes.executionId = "${args.executionId}" AND attributes.runnerNodeId = "${args.nodeId}" AND attributes.messageKind = "runner_event"`,
      subscriptionName: eventSubscriptionName,
    },
  ];
  try {
    for (const subscription of subscriptions) {
      await ensureRunnerSubscription({
        accessToken: args.accessToken,
        filter: subscription.filter,
        projectId: args.projectId,
        subscriptionName: subscription.subscriptionName,
        topicName: args.topicName,
      });
    }
  } catch (error) {
    await Promise.allSettled(
      subscriptions.map((subscription) =>
        deleteRunnerSubscription({
          accessToken: args.accessToken,
          projectId: args.projectId,
          subscriptionName: subscription.subscriptionName,
        }),
      ),
    );
    throw error;
  }

  return createPubSubRunnerControlFromSubscriptions({
    ...args,
    controlSubscriptionName,
    eventSubscriptionName,
    protocolToken,
    statusSubscriptionName,
    resultSubscriptionName,
  });
}

export function createPubSubRunnerControlFromSubscriptions(args: {
  accessToken?: string;
  controlSubscriptionName: string;
  eventSubscriptionName: string;
  executionId: string;
  nodeId: string;
  onRunnerEvent?: (event: Record<string, unknown>) => Promise<void>;
  projectId: string;
  protocolToken: string;
  runnerReadyTimeoutMs?: number;
  statusSubscriptionName: string;
  resultSubscriptionName: string;
  topicName: string;
}): PubSubRunnerControl {
  const controlSubscriptionName = args.controlSubscriptionName;
  const statusSubscriptionName = args.statusSubscriptionName;
  const resultSubscriptionName = args.resultSubscriptionName;
  const eventSubscriptionName = args.eventSubscriptionName;
  const eventPump = startRunnerEventPump({
    accessToken: args.accessToken,
    executionId: args.executionId,
    nodeId: args.nodeId,
    onRunnerEvent: args.onRunnerEvent,
    projectId: args.projectId,
    protocolToken: args.protocolToken,
    subscriptionName: eventSubscriptionName,
  });

  const publishStart = async () => {
    await publishRunnerControlMessage({
      accessToken: args.accessToken,
      action: 'start',
      executionId: args.executionId,
      nodeId: args.nodeId,
      projectId: args.projectId,
      protocolToken: args.protocolToken,
      topicName: args.topicName,
    });
  };

  const waitUntilReady = async (payload?: Record<string, unknown>) => {
    const publishPrepare = payload
      ? async () => {
          await publishRunnerControlMessage({
            accessToken: args.accessToken,
            action: 'start',
            executionId: args.executionId,
            nodeId: args.nodeId,
            payload,
            prepareOnly: true,
            projectId: args.projectId,
            protocolToken: args.protocolToken,
            topicName: args.topicName,
          });
        }
      : undefined;
    await waitForRunnerReady({
      accessToken: args.accessToken,
      executionId: args.executionId,
      nodeId: args.nodeId,
      projectId: args.projectId,
      protocolToken: args.protocolToken,
      ...(publishPrepare ? { publishPrepare } : {}),
      subscriptionName: statusSubscriptionName,
      timeoutMs: args.runnerReadyTimeoutMs,
      waitForEventSequence: eventPump.waitUntilSequence,
    });
  };

  return {
    cleanup: async () => {
      eventPump.stop();
      await Promise.all([
        deleteRunnerSubscription({
          accessToken: args.accessToken,
          projectId: args.projectId,
          subscriptionName: controlSubscriptionName,
        }),
        deleteRunnerSubscription({
          accessToken: args.accessToken,
          projectId: args.projectId,
          subscriptionName: statusSubscriptionName,
        }),
        deleteRunnerSubscription({
          accessToken: args.accessToken,
          projectId: args.projectId,
          subscriptionName: resultSubscriptionName,
        }),
        deleteRunnerSubscription({
          accessToken: args.accessToken,
          projectId: args.projectId,
          subscriptionName: eventSubscriptionName,
        }),
      ]);
    },
    eventSubscriptionName,
    payload: {
      controlSubscriptionName,
      projectId: args.projectId,
      protocolToken: args.protocolToken,
      topicName: args.topicName,
      type: 'gcp_pubsub',
    },
    publishCancel: async () => {
      await publishRunnerControlMessage({
        accessToken: args.accessToken,
        action: 'cancel',
        executionId: args.executionId,
        nodeId: args.nodeId,
        projectId: args.projectId,
        protocolToken: args.protocolToken,
        topicName: args.topicName,
      });
    },
    publishStart: async () => {
      await publishStart();
    },
    startWithRetry: async () => {
      await waitForRunnerStarted({
        accessToken: args.accessToken,
        executionId: args.executionId,
        nodeId: args.nodeId,
        projectId: args.projectId,
        protocolToken: args.protocolToken,
        publishStart,
        subscriptionName: statusSubscriptionName,
        waitForEventSequence: eventPump.waitUntilSequence,
      });
    },
    waitForCompletion: async () => {
      const { lastRunnerEventSequence, ...result } =
        await waitForRunnerCompletion({
          accessToken: args.accessToken,
          executionId: args.executionId,
          nodeId: args.nodeId,
          projectId: args.projectId,
          protocolToken: args.protocolToken,
          subscriptionName: resultSubscriptionName,
        });
      await eventPump.waitUntilSequence(lastRunnerEventSequence);
      return result;
    },
    statusSubscriptionName,
    waitUntilReady: async () => waitUntilReady(),
    waitUntilReadyWithPayload: async (payload) => waitUntilReady(payload),
  };
}
