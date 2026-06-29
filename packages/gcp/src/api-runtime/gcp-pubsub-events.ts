import { type GcpTokenRefresh, refreshGcpAccessTokenIfNeeded } from './gcs';
import type { GcpExecutionEvents } from './contracts';

type PubSubEventStream = {
  creds: GcpTokenRefresh;
  emulatorHost: string | null;
  projectId: string;
  stop: () => void;
  subscriptionName: string;
  topicName: string;
};

type PubSubMessage = {
  ackId: string;
  message: {
    attributes?: Record<string, string>;
    data?: string;
    messageId?: string;
    publishTime?: string;
  };
};

type PubSubPullResponse = {
  receivedMessages?: PubSubMessage[];
};

export type GcpPubSubEventTransport = {
  projectId: string;
  subscriptionName: string;
  topicName: string;
  type: 'gcp_pubsub';
};

export type GcpPubSubEventStreamManager = {
  ensureGcpPubSubEventStream(params: {
    creds: GcpTokenRefresh;
    emulatorHost?: string | null;
    executionId: string;
    projectId: string;
  }): Promise<GcpPubSubEventTransport>;
  stopGcpPubSubEventStream(executionId: string): void;
};

const PUBSUB_API_BASE_URL = 'https://pubsub.googleapis.com/v1';
const DEFAULT_TOPIC_NAME = 'playrunner-workflow-events';
const SUBSCRIPTION_ACK_DEADLINE_SECONDS = 30;
const SUBSCRIPTION_RETENTION_SECONDS = 24 * 60 * 60;
const PULL_MAX_MESSAGES = 50;
const EMPTY_PULL_DELAY_MS = 1000;
const ERROR_PULL_DELAY_MS = 3000;

const activeStreams = new Map<string, PubSubEventStream>();

class PubSubRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizePubSubId(value: string, fallback: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9._~%+-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 255);

  return sanitized || fallback;
}

function getConfiguredTopicName(): string {
  return sanitizePubSubId(
    process.env.GCP_PUBSUB_WORKFLOW_EVENTS_TOPIC || DEFAULT_TOPIC_NAME,
    DEFAULT_TOPIC_NAME,
  );
}

function getPubSubApiBaseUrl(emulatorHost: string | null): string {
  const normalizedEmulatorHost = emulatorHost?.trim();
  if (!normalizedEmulatorHost) {
    return PUBSUB_API_BASE_URL;
  }

  const normalizedHost = normalizedEmulatorHost.replace(/\/+$/, '');
  return `${normalizedHost.startsWith('http') ? normalizedHost : `http://${normalizedHost}`}/v1`;
}

function isUsingPubSubEmulator(emulatorHost: string | null): boolean {
  return !!emulatorHost?.trim();
}

function getSubscriptionName(executionId: string): string {
  return sanitizePubSubId(
    `playrunner-api-events-${executionId}`,
    `playrunner-api-events-${Date.now()}`,
  );
}

function isTerminalEvent(type: unknown): boolean {
  return (
    type === 'workflow_completed' ||
    type === 'workflow_failed' ||
    type === 'workflow_cancelled'
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function getFreshAccessToken(
  creds: GcpTokenRefresh,
  emulatorHost: string | null,
): Promise<string> {
  if (isUsingPubSubEmulator(emulatorHost)) {
    return '';
  }

  const refreshed = await refreshGcpAccessTokenIfNeeded(creds);
  if (refreshed) {
    creds.accessToken = refreshed;
  }
  if (!creds.accessToken) {
    throw new Error('Pub/Sub access token is required.');
  }
  return creds.accessToken;
}

async function pubsubRequest<T>(
  creds: GcpTokenRefresh,
  resourcePath: string,
  init: RequestInit = {},
  emulatorHost: string | null = null,
): Promise<T> {
  const accessToken = await getFreshAccessToken(creds, emulatorHost);
  const response = await fetch(
    `${getPubSubApiBaseUrl(emulatorHost)}/${resourcePath}`,
    {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(init.headers || {}),
      },
    },
  );

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new PubSubRequestError(
      `Pub/Sub API returned ${response.status}: ${details.slice(0, 500)}`,
      response.status,
    );
  }

  if (response.status === 204) {
    return {} as T;
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

async function ensureTopic(params: {
  creds: GcpTokenRefresh;
  emulatorHost: string | null;
  projectId: string;
  topicName: string;
}) {
  try {
    await pubsubRequest(
      params.creds,
      `projects/${params.projectId}/topics/${params.topicName}`,
      { method: 'GET' },
      params.emulatorHost,
    );
    return;
  } catch (error) {
    if (!(error instanceof PubSubRequestError) || error.status !== 404) {
      throw error;
    }
  }

  try {
    await pubsubRequest(
      params.creds,
      `projects/${params.projectId}/topics/${params.topicName}`,
      {
        body: JSON.stringify({}),
        method: 'PUT',
      },
      params.emulatorHost,
    );
    console.log(
      `[PubSub] Created topic projects/${params.projectId}/topics/${params.topicName}.`,
    );
  } catch (error) {
    if (!(error instanceof PubSubRequestError) || error.status !== 409) {
      throw error;
    }
  }
}

async function ensureSubscription(params: {
  creds: GcpTokenRefresh;
  emulatorHost: string | null;
  executionId: string;
  projectId: string;
  subscriptionName: string;
  topicName: string;
}) {
  try {
    await pubsubRequest(
      params.creds,
      `projects/${params.projectId}/subscriptions/${params.subscriptionName}`,
      {
        body: JSON.stringify({
          ackDeadlineSeconds: SUBSCRIPTION_ACK_DEADLINE_SECONDS,
          enableMessageOrdering: true,
          expirationPolicy: {
            ttl: `${SUBSCRIPTION_RETENTION_SECONDS}s`,
          },
          filter: `attributes.executionId = "${params.executionId}"`,
          messageRetentionDuration: `${SUBSCRIPTION_RETENTION_SECONDS}s`,
          topic: `projects/${params.projectId}/topics/${params.topicName}`,
        }),
        method: 'PUT',
      },
      params.emulatorHost,
    );
    console.log(
      `[PubSub] Created subscription projects/${params.projectId}/subscriptions/${params.subscriptionName}.`,
    );
  } catch (error) {
    if (!(error instanceof PubSubRequestError) || error.status !== 409) {
      throw error;
    }
  }
}

async function pullMessages(params: {
  creds: GcpTokenRefresh;
  emulatorHost: string | null;
  projectId: string;
  subscriptionName: string;
}) {
  return pubsubRequest<PubSubPullResponse>(
    params.creds,
    `projects/${params.projectId}/subscriptions/${params.subscriptionName}:pull`,
    {
      body: JSON.stringify({
        maxMessages: PULL_MAX_MESSAGES,
        returnImmediately: true,
      }),
      method: 'POST',
    },
    params.emulatorHost,
  );
}

async function acknowledgeMessage(params: {
  ackId: string;
  creds: GcpTokenRefresh;
  emulatorHost: string | null;
  projectId: string;
  subscriptionName: string;
}) {
  await pubsubRequest(
    params.creds,
    `projects/${params.projectId}/subscriptions/${params.subscriptionName}:acknowledge`,
    {
      body: JSON.stringify({ ackIds: [params.ackId] }),
      method: 'POST',
    },
    params.emulatorHost,
  );
}

async function nackMessage(params: {
  ackId: string;
  creds: GcpTokenRefresh;
  emulatorHost: string | null;
  projectId: string;
  subscriptionName: string;
}) {
  await pubsubRequest(
    params.creds,
    `projects/${params.projectId}/subscriptions/${params.subscriptionName}:modifyAckDeadline`,
    {
      body: JSON.stringify({
        ackDeadlineSeconds: 0,
        ackIds: [params.ackId],
      }),
      method: 'POST',
    },
    params.emulatorHost,
  );
}

async function deleteSubscription(params: {
  creds: GcpTokenRefresh;
  emulatorHost: string | null;
  projectId: string;
  subscriptionName: string;
}) {
  try {
    await pubsubRequest(
      params.creds,
      `projects/${params.projectId}/subscriptions/${params.subscriptionName}`,
      { method: 'DELETE' },
      params.emulatorHost,
    );
  } catch (error) {
    console.warn(
      `[PubSub] Failed to delete subscription ${params.subscriptionName}: ${getErrorMessage(error)}`,
    );
  }
}

function decodeMessagePayload(message: PubSubMessage['message']) {
  if (!message.data) {
    throw new Error('Pub/Sub message is missing data.');
  }

  const decoded = Buffer.from(message.data, 'base64').toString('utf8');
  const parsed = JSON.parse(decoded) as Record<string, unknown>;
  const { executionAuthToken: _executionAuthToken, ...event } = parsed;

  return {
    event,
    executionAuthToken:
      typeof parsed.executionAuthToken === 'string'
        ? parsed.executionAuthToken
        : '',
  };
}

async function processMessage(params: {
  executionEvents: GcpExecutionEvents;
  expectedExecutionId: string;
  message: PubSubMessage;
}) {
  const messageKind = params.message.message.attributes?.messageKind;
  if (messageKind === 'runner_control' || messageKind === 'runner_status') {
    return { eventType: undefined };
  }

  const { event, executionAuthToken } = decodeMessagePayload(
    params.message.message,
  );
  const executionId =
    typeof event.executionId === 'string'
      ? event.executionId
      : typeof event.testId === 'string'
        ? event.testId
        : '';

  if (executionId !== params.expectedExecutionId) {
    throw new Error(
      `Pub/Sub event executionId ${executionId || '<missing>'} does not match ${params.expectedExecutionId}.`,
    );
  }

  if (!executionAuthToken) {
    throw new Error('Pub/Sub event is missing executionAuthToken.');
  }

  const execution = await params.executionEvents.verifyExecutionToken(
    executionId,
    executionAuthToken,
  );

  if (!execution) {
    throw new Error(`Pub/Sub event token rejected for ${executionId}.`);
  }

  await params.executionEvents.appendEvent(execution.id, event);
  return { eventType: event.type };
}

function startSubscriber(params: {
  creds: GcpTokenRefresh;
  emulatorHost: string | null;
  executionEvents: GcpExecutionEvents;
  executionId: string;
  projectId: string;
  subscriptionName: string;
  topicName: string;
}) {
  const existing = activeStreams.get(params.executionId);
  if (existing) {
    return existing;
  }

  let stopped = false;
  const stream: PubSubEventStream = {
    creds: params.creds,
    emulatorHost: params.emulatorHost,
    projectId: params.projectId,
    stop: () => {
      stopped = true;
      activeStreams.delete(params.executionId);
    },
    subscriptionName: params.subscriptionName,
    topicName: params.topicName,
  };
  activeStreams.set(params.executionId, stream);

  const loop = async () => {
    while (!stopped) {
      try {
        const response = await pullMessages(params);
        const messages = response.receivedMessages || [];

        if (messages.length === 0) {
          await sleep(EMPTY_PULL_DELAY_MS);
          continue;
        }

        for (const message of messages) {
          if (stopped) {
            return;
          }

          try {
            const { eventType } = await processMessage({
              executionEvents: params.executionEvents,
              expectedExecutionId: params.executionId,
              message,
            });
            await acknowledgeMessage({
              ackId: message.ackId,
              creds: params.creds,
              emulatorHost: params.emulatorHost,
              projectId: params.projectId,
              subscriptionName: params.subscriptionName,
            });

            if (isTerminalEvent(eventType)) {
              stream.stop();
              void deleteSubscription(params);
              return;
            }
          } catch (error) {
            console.error(
              `[PubSub] Failed to persist message for ${params.executionId}:`,
              error,
            );
            await nackMessage({
              ackId: message.ackId,
              creds: params.creds,
              emulatorHost: params.emulatorHost,
              projectId: params.projectId,
              subscriptionName: params.subscriptionName,
            }).catch((nackError) => {
              console.error(
                `[PubSub] Failed to nack message for ${params.executionId}:`,
                nackError,
              );
            });
          }
        }
      } catch (error) {
        if (!stopped) {
          console.error(
            `[PubSub] Pull loop failed for ${params.executionId}:`,
            error,
          );
          await sleep(ERROR_PULL_DELAY_MS);
        }
      }
    }
  };

  void loop();
  return stream;
}

async function ensureGcpPubSubEventStream(
  params: {
    creds: GcpTokenRefresh;
    emulatorHost?: string | null;
    executionId: string;
    projectId: string;
  },
  executionEvents: GcpExecutionEvents,
): Promise<GcpPubSubEventTransport> {
  const emulatorHost = params.emulatorHost ?? null;
  const topicName = getConfiguredTopicName();
  const subscriptionName = getSubscriptionName(params.executionId);
  const transportTarget = emulatorHost
    ? `Pub/Sub emulator at ${emulatorHost}`
    : 'managed GCP Pub/Sub';

  console.log(
    `[PubSub] Configuring workflow event stream for ${params.executionId} using ${transportTarget}.`,
  );

  await ensureTopic({
    creds: params.creds,
    emulatorHost,
    projectId: params.projectId,
    topicName,
  });
  await ensureSubscription({
    creds: params.creds,
    emulatorHost,
    executionId: params.executionId,
    projectId: params.projectId,
    subscriptionName,
    topicName,
  });
  startSubscriber({
    creds: params.creds,
    emulatorHost,
    executionEvents,
    executionId: params.executionId,
    projectId: params.projectId,
    subscriptionName,
    topicName,
  });

  return {
    projectId: params.projectId,
    subscriptionName,
    topicName,
    type: 'gcp_pubsub',
  };
}

function stopGcpPubSubEventStream(executionId: string) {
  const stream = activeStreams.get(executionId);
  if (!stream) {
    return;
  }

  stream.stop();
  void deleteSubscription({
    creds: stream.creds,
    emulatorHost: stream.emulatorHost,
    projectId: stream.projectId,
    subscriptionName: stream.subscriptionName,
  });
}

export function createGcpPubSubEventStreamManager(
  executionEvents: GcpExecutionEvents,
): GcpPubSubEventStreamManager {
  return {
    ensureGcpPubSubEventStream: (params: {
      creds: GcpTokenRefresh;
      emulatorHost?: string | null;
      executionId: string;
      projectId: string;
    }) => ensureGcpPubSubEventStream(params, executionEvents),
    stopGcpPubSubEventStream,
  };
}
