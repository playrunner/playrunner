import crypto from 'crypto';

type PubSubPullResponse = {
  receivedMessages?: Array<{
    ackId: string;
    message: {
      data?: string;
    };
  }>;
};

export type PubSubRunnerControl = {
  cleanup: () => Promise<void>;
  payload: {
    controlSubscriptionName: string;
    projectId: string;
    topicName: string;
    type: 'gcp_pubsub';
  };
  publishCancel: () => Promise<void>;
  publishStart: () => Promise<void>;
  startWithRetry: () => Promise<void>;
  statusSubscriptionName: string;
  waitUntilReady: () => Promise<void>;
};

const PUBSUB_API_BASE_URL = 'https://pubsub.googleapis.com/v1';
const MAX_TRANSIENT_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 1000;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const RUNNER_CONTROL_ACK_DEADLINE_SECONDS = 60;
// GCP Pub/Sub minimum subscription expiration TTL is 24 hours.
const RUNNER_CONTROL_RETENTION_SECONDS = 24 * 60 * 60;
const RUNNER_READY_TIMEOUT_MS = 30 * 60 * 1000;
const RUNNER_START_CONFIRM_TIMEOUT_MS = 30 * 60 * 1000;
const RUNNER_START_RETRY_INTERVAL_MS = 3000;
const RUNNER_STATUS_POLL_INTERVAL_MS = 1000;
const DEFAULT_WORKFLOW_EVENTS_TOPIC = 'playrunner-workflow-events';

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
      response = await fetch(`${getPubSubApiBaseUrl()}/${resourcePath}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(init.headers || {}),
        },
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
  topicName: string;
}) {
  const eventId = crypto.randomUUID();
  const payload = {
    action: args.action,
    eventId,
    executionId: args.executionId,
    nodeId: args.nodeId,
    testId: args.executionId,
    timestamp: new Date().toISOString(),
    type: 'runner_control',
  };

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
  return JSON.parse(Buffer.from(message.data, 'base64').toString('utf8'));
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

async function waitForRunnerReady(args: {
  accessToken?: string;
  executionId: string;
  nodeId: string;
  projectId: string;
  subscriptionName: string;
}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < RUNNER_READY_TIMEOUT_MS) {
    const response = await pullRunnerStatusMessages(args);
    const messages = response.receivedMessages || [];
    const ackIds = messages.map((message) => message.ackId);

    try {
      for (const message of messages) {
        const payload = decodePubSubPayload(message.message);
        if (
          payload.executionId !== args.executionId ||
          payload.nodeId !== args.nodeId
        ) {
          continue;
        }

        if (payload.status === 'ready' || payload.status === 'started') {
          return;
        }

        if (
          payload.status === 'prepare_failed' ||
          payload.status === 'failed'
        ) {
          throw new Error(
            payload.error ||
              `Prepared Playwright runner reported ${payload.status}.`,
          );
        }
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
    `Timed out waiting for prepared Playwright runner ${args.nodeId}.`,
  );
}

async function waitForRunnerStarted(args: {
  accessToken?: string;
  executionId: string;
  nodeId: string;
  projectId: string;
  publishStart: () => Promise<void>;
  subscriptionName: string;
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

    try {
      for (const message of messages) {
        const payload = decodePubSubPayload(message.message);
        if (
          payload.executionId !== args.executionId ||
          payload.nodeId !== args.nodeId
        ) {
          continue;
        }

        if (payload.status === 'started') {
          return;
        }

        if (
          payload.status === 'cancelled' ||
          payload.status === 'prepare_failed' ||
          payload.status === 'failed'
        ) {
          throw new Error(
            payload.error ||
              `Prepared Playwright runner reported ${payload.status}.`,
          );
        }
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
    `Timed out waiting for prepared Playwright runner ${args.nodeId} to acknowledge start.`,
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
  projectId: string;
  topicName: string;
}): Promise<PubSubRunnerControl> {
  const controlSubscriptionName = getRunnerControlSubscriptionName(args);
  const statusSubscriptionName = getRunnerStatusSubscriptionName(args);

  await ensurePubSubTopic(args);
  await Promise.all([
    ensureRunnerSubscription({
      accessToken: args.accessToken,
      filter: `attributes.executionId = "${args.executionId}" AND attributes.nodeId = "${args.nodeId}" AND attributes.messageKind = "runner_control"`,
      projectId: args.projectId,
      subscriptionName: controlSubscriptionName,
      topicName: args.topicName,
    }),
    ensureRunnerSubscription({
      accessToken: args.accessToken,
      filter: `attributes.executionId = "${args.executionId}" AND attributes.nodeId = "${args.nodeId}" AND attributes.messageKind = "runner_status"`,
      projectId: args.projectId,
      subscriptionName: statusSubscriptionName,
      topicName: args.topicName,
    }),
  ]);

  return createPubSubRunnerControlFromSubscriptions({
    ...args,
    controlSubscriptionName,
    statusSubscriptionName,
  });
}

export function createPubSubRunnerControlFromSubscriptions(args: {
  accessToken?: string;
  controlSubscriptionName: string;
  executionId: string;
  nodeId: string;
  projectId: string;
  statusSubscriptionName: string;
  topicName: string;
}): PubSubRunnerControl {
  const controlSubscriptionName = args.controlSubscriptionName;
  const statusSubscriptionName = args.statusSubscriptionName;

  const publishStart = async () => {
    await publishRunnerControlMessage({
      accessToken: args.accessToken,
      action: 'start',
      executionId: args.executionId,
      nodeId: args.nodeId,
      projectId: args.projectId,
      topicName: args.topicName,
    });
  };

  return {
    cleanup: async () => {
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
      ]);
    },
    payload: {
      controlSubscriptionName,
      projectId: args.projectId,
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
        publishStart,
        subscriptionName: statusSubscriptionName,
      });
    },
    statusSubscriptionName,
    waitUntilReady: async () => {
      await waitForRunnerReady({
        accessToken: args.accessToken,
        executionId: args.executionId,
        nodeId: args.nodeId,
        projectId: args.projectId,
        subscriptionName: statusSubscriptionName,
      });
    },
  };
}
