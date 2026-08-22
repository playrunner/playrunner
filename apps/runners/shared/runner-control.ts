import crypto from 'node:crypto';
import {
  MAX_RUNNER_PROTOCOL_PAYLOAD_BYTES,
  verifyRunnerProtocolPayload,
  withRunnerProtocolSignature,
} from './runner-protocol';

export type RunnerControlConfig = {
  controlSubscriptionName: string;
  projectId: string;
  protocolToken: string;
  topicName: string;
  type: 'gcp_pubsub';
};

export type RunnerControlStatus =
  | 'cancelled'
  | 'completed'
  | 'failed'
  | 'prepare_failed'
  | 'ready'
  | 'started';

export type RunnerDiagnosticLog = {
  level: 'error' | 'info';
  message: string;
  nodeId?: string;
  timestamp: string;
};

export type RunnerEventIdentity = {
  nodeId: string;
  parentNodeId?: string;
};

type PubSubPullResponse = {
  receivedMessages?: Array<{
    ackId: string;
    message: { data?: string };
  }>;
};

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type RunnerControlClient = {
  log: (
    message: string,
    level?: 'error' | 'info',
    identity?: RunnerEventIdentity,
  ) => Promise<void>;
  publishNodeState: (
    state: 'error' | 'pending' | 'running' | 'success' | 'warning',
    identity?: RunnerEventIdentity,
  ) => Promise<void>;
  publishEvent: (
    event: Record<string, unknown>,
    identity?: RunnerEventIdentity,
  ) => Promise<void>;
  publishStatus: (
    status: RunnerControlStatus,
    error?: string,
    output?: Record<string, unknown>,
  ) => Promise<void>;
  waitForStartPayload: () => Promise<
    { action: 'cancel' } | { action: 'start'; payload: Record<string, unknown> }
  >;
  waitForStartSignal: () => Promise<'cancel' | 'start'>;
};

const PUBSUB_API_BASE_URL = 'https://pubsub.googleapis.com/v1';
const CONTROL_POLL_INTERVAL_MS = 1_000;
const CONTROL_SIGNAL_TIMEOUT_MS = 25 * 60 * 60 * 1_000;
const PUBSUB_REQUEST_TIMEOUT_MS = 10_000;
const PUBSUB_MAX_TRANSIENT_RETRIES = 2;
const PUBSUB_RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RUNNER_DIAGNOSTIC_LOG_BYTES = 64 * 1_024;
const MAX_RUNNER_DIAGNOSTIC_LOG_ENTRIES = 100;
const MAX_RUNNER_DIAGNOSTIC_MESSAGE_LENGTH = 2_000;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getPubSubApiBaseUrl(): string {
  const emulatorHost = process.env.PUBSUB_EMULATOR_HOST?.trim();
  if (!emulatorHost) return PUBSUB_API_BASE_URL;
  const normalizedHost = emulatorHost.replace(/\/+$/, '');
  return `${normalizedHost.startsWith('http') ? normalizedHost : `http://${normalizedHost}`}/v1`;
}

function isUsingPubSubEmulator(): boolean {
  return Boolean(process.env.PUBSUB_EMULATOR_HOST?.trim());
}

function decodePubSubPayload(message: {
  data?: string;
}): Record<string, unknown> {
  if (!message.data) return {};
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
  const value: unknown = JSON.parse(decoded.toString('utf8'));
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function boundedMessage(value: string): string {
  return value.slice(0, MAX_RUNNER_DIAGNOSTIC_MESSAGE_LENGTH);
}

export function createRunnerControlClient(options: {
  apiBaseUrl?: string;
  config: RunnerControlConfig;
  controlPollIntervalMs?: number;
  controlSignalTimeoutMs?: number;
  executionId: string;
  fetcher?: Fetcher;
  gcpAccessToken?: string;
  nodeId: string;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  diagnosticLogs?: RunnerDiagnosticLog[];
  logPrefix?: string;
  runnerName?: string;
  workflowEventAttributes?: Record<string, string>;
  workflowEventFields?: Record<string, unknown>;
}): RunnerControlClient {
  const fetcher = options.fetcher || fetch;
  const now = options.now || Date.now;
  const wait = options.sleep || sleep;
  const apiBaseUrl = (options.apiBaseUrl || getPubSubApiBaseUrl()).replace(
    /\/+$/,
    '',
  );
  const diagnosticLogs = options.diagnosticLogs || [];
  const logPrefix = options.logPrefix || '[Runner]';
  const runnerName = options.runnerName || 'runner';
  let runnerEventSequence = 0;
  let eventPublishChain: Promise<void> = Promise.resolve();
  let eventStreamClosed = false;
  let eventStreamFailed = false;
  let eventStreamFailure: unknown;

  const request = async <T>(
    resourcePath: string,
    init: RequestInit,
  ): Promise<T> => {
    if (
      !options.gcpAccessToken &&
      !options.apiBaseUrl &&
      !isUsingPubSubEmulator()
    ) {
      throw new Error('Pub/Sub access token is required.');
    }
    let lastError: unknown;
    for (let attempt = 0; attempt <= PUBSUB_MAX_TRANSIENT_RETRIES; attempt++) {
      try {
        const isGoogleApi = apiBaseUrl === PUBSUB_API_BASE_URL;
        const response = await fetcher(`${apiBaseUrl}/${resourcePath}`, {
          ...init,
          headers: {
            'Content-Type': 'application/json',
            ...(options.gcpAccessToken && isGoogleApi
              ? { Authorization: `Bearer ${options.gcpAccessToken}` }
              : {}),
            ...(init.headers || {}),
          },
          signal: init.signal || AbortSignal.timeout(PUBSUB_REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) {
          const details = await response.text().catch(() => '');
          const error = new Error(
            `Pub/Sub API returned ${response.status}: ${details.slice(0, 500)}`,
          );
          if (
            !PUBSUB_RETRYABLE_STATUS_CODES.has(response.status) ||
            attempt === PUBSUB_MAX_TRANSIENT_RETRIES
          ) {
            throw Object.assign(error, { retryable: false });
          }
          lastError = error;
        } else {
          if (response.status === 204) return {} as T;
          const text = await response.text();
          return (text ? JSON.parse(text) : {}) as T;
        }
      } catch (error) {
        lastError = error;
        if (
          (error as { retryable?: boolean })?.retryable === false ||
          attempt === PUBSUB_MAX_TRANSIENT_RETRIES
        ) {
          throw error;
        }
      }
      await wait(250 * 2 ** attempt);
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Pub/Sub request failed.');
  };

  const publish = async (
    payload: Record<string, unknown>,
    messageKind: 'runner_event' | 'runner_result' | 'runner_status',
    eventType: string,
  ): Promise<void> => {
    const eventId =
      typeof payload.eventId === 'string' && payload.eventId
        ? payload.eventId
        : crypto.randomUUID();
    const eventPayload: Record<string, unknown> = { ...payload, eventId };
    const messageNodeId =
      messageKind === 'runner_event' && typeof eventPayload.nodeId === 'string'
        ? eventPayload.nodeId
        : options.nodeId;
    await request(
      `projects/${encodeURIComponent(options.config.projectId)}/topics/${encodeURIComponent(options.config.topicName)}:publish`,
      {
        body: JSON.stringify({
          messages: [
            {
              attributes: {
                ...(messageKind === 'runner_event'
                  ? options.workflowEventAttributes
                  : {}),
                eventId,
                eventType,
                executionId: options.executionId,
                messageKind,
                nodeId: messageNodeId,
                ...(messageKind === 'runner_event'
                  ? { runnerNodeId: options.nodeId }
                  : {}),
              },
              data: Buffer.from(JSON.stringify(eventPayload), 'utf8').toString(
                'base64',
              ),
              orderingKey:
                messageKind === 'runner_event'
                  ? options.executionId
                  : `${options.executionId}:${messageNodeId}`,
            },
          ],
        }),
        method: 'POST',
      },
    );
  };

  const publishWorkflowEvent = async (
    event: Record<string, unknown>,
    identity?: RunnerEventIdentity,
    failClosed = false,
  ): Promise<void> => {
    if (eventStreamClosed) return;
    const safeEvent = Object.fromEntries(
      Object.entries(event).filter(
        ([key]) =>
          ![
            'executionAuthToken',
            'protocolSignature',
            'protocolToken',
            'runnerEventSequence',
            'runnerNodeId',
          ].includes(key),
      ),
    );
    const publishEvent = eventPublishChain.then(async () => {
      // A failed publish is ambiguous: Pub/Sub may have accepted the event even
      // when every response was lost. Never reuse that event's sequence for a
      // later event, because the consumer would discard the later event as a
      // duplicate. Diagnostic callers may suppress the original error, but a
      // subsequent critical event still fails closed on this poisoned stream.
      if (eventStreamFailed) {
        throw eventStreamFailure instanceof Error
          ? eventStreamFailure
          : new Error('Runner event publication previously failed.');
      }
      const eventId = crypto.randomUUID();
      const nextSequence = runnerEventSequence + 1;
      try {
        await publish(
          withRunnerProtocolSignature(
            {
              ...(options.workflowEventFields || {}),
              ...safeEvent,
              eventId,
              executionId: options.executionId,
              nodeId: identity?.nodeId || options.nodeId,
              ...(identity?.parentNodeId
                ? { parentNodeId: identity.parentNodeId }
                : {}),
              runnerEventSequence: nextSequence,
              runnerNodeId: options.nodeId,
              testId: options.executionId,
              timestamp: new Date(now()).toISOString(),
            },
            options.config.protocolToken,
          ),
          'runner_event',
          typeof safeEvent.type === 'string' ? safeEvent.type : 'event',
        );
      } catch (error) {
        eventStreamFailed = true;
        eventStreamFailure = error;
        throw error;
      }
      runnerEventSequence = nextSequence;
    });
    eventPublishChain = publishEvent.catch(() => undefined);
    try {
      await publishEvent;
    } catch (error) {
      console.error(
        `${logPrefix} Failed to publish workflow event: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (failClosed) throw error;
    }
  };

  const acknowledge = async (ackIds: string[]): Promise<void> => {
    if (!ackIds.length) return;
    await request(
      `projects/${encodeURIComponent(options.config.projectId)}/subscriptions/${encodeURIComponent(options.config.controlSubscriptionName)}:acknowledge`,
      {
        body: JSON.stringify({ ackIds }),
        method: 'POST',
      },
    );
  };

  const waitForControlSignal = async (
    mode: 'payload' | 'signal',
  ): Promise<
    | { action: 'cancel' }
    | { action: 'start'; payload?: Record<string, unknown> }
  > => {
    const startedAt = now();
    const timeoutMs =
      options.controlSignalTimeoutMs || CONTROL_SIGNAL_TIMEOUT_MS;
    while (now() - startedAt < timeoutMs) {
      const response = await request<PubSubPullResponse>(
        `projects/${encodeURIComponent(options.config.projectId)}/subscriptions/${encodeURIComponent(options.config.controlSubscriptionName)}:pull`,
        {
          body: JSON.stringify({ maxMessages: 10, returnImmediately: true }),
          method: 'POST',
        },
      );
      const messages = response.receivedMessages || [];
      const ackIds = messages.map((message) => message.ackId);
      let matched:
        | { action: 'cancel' }
        | { action: 'start'; payload?: Record<string, unknown> }
        | undefined;
      try {
        for (const message of messages) {
          let envelope: Record<string, unknown>;
          try {
            envelope = decodePubSubPayload(message.message);
            if (
              envelope.executionId !== options.executionId ||
              envelope.nodeId !== options.nodeId ||
              !verifyRunnerProtocolPayload(
                envelope,
                options.config.protocolToken,
              )
            ) {
              continue;
            }
          } catch {
            continue;
          }
          if (envelope.action === 'cancel') {
            matched = { action: 'cancel' };
            continue;
          }
          if (matched?.action === 'cancel' || envelope.action !== 'start') {
            continue;
          }
          if (mode === 'signal') {
            // A prepare-only start carries the hosted runner payload. It must
            // never start execution, including when Pub/Sub redelivers it
            // after the runner has published ready.
            if (envelope.prepareOnly === undefined) {
              matched = { action: 'start' };
            }
            continue;
          }
          if (
            envelope.prepareOnly === true &&
            envelope.payload &&
            typeof envelope.payload === 'object' &&
            !Array.isArray(envelope.payload)
          ) {
            matched = {
              action: 'start',
              payload: envelope.payload as Record<string, unknown>,
            };
          }
        }
      } finally {
        await acknowledge(ackIds);
      }
      if (matched) return matched;
      await wait(options.controlPollIntervalMs || CONTROL_POLL_INTERVAL_MS);
    }
    throw new Error(
      `Timed out waiting for ${runnerName} ${mode === 'payload' ? 'payload' : 'start signal'}.`,
    );
  };

  return {
    log: async (message, level = 'info', identity) => {
      const formattedMessage = boundedMessage(`${logPrefix} ${message}`);
      const entry: RunnerDiagnosticLog = {
        level,
        message: formattedMessage,
        nodeId: identity?.nodeId || options.nodeId,
        timestamp: new Date(now()).toISOString(),
      };
      diagnosticLogs.push(entry);
      while (
        diagnosticLogs.length > MAX_RUNNER_DIAGNOSTIC_LOG_ENTRIES ||
        Buffer.byteLength(JSON.stringify(diagnosticLogs), 'utf8') >
          MAX_RUNNER_DIAGNOSTIC_LOG_BYTES
      ) {
        diagnosticLogs.shift();
      }
      if (level === 'error') console.error(formattedMessage);
      else console.log(formattedMessage);
      await publishWorkflowEvent({ ...entry, type: 'log' }, identity);
    },
    publishNodeState: async (state, identity) => {
      await publishWorkflowEvent(
        {
          state,
          type: 'node_state',
        },
        identity,
        true,
      );
    },
    publishEvent: publishWorkflowEvent,
    publishStatus: async (status, error, output) => {
      const terminalStatus =
        status === 'cancelled' ||
        status === 'completed' ||
        status === 'failed' ||
        status === 'prepare_failed';
      if (terminalStatus) {
        eventStreamClosed = true;
        await eventPublishChain;
      }
      const eventId = crypto.randomUUID();
      const payload = withRunnerProtocolSignature(
        {
          ...(status === 'completed'
            ? { diagnosticLogs: [...diagnosticLogs] }
            : {}),
          ...(error ? { error: boundedMessage(error) } : {}),
          eventId,
          executionId: options.executionId,
          ...(terminalStatus
            ? { lastRunnerEventSequence: runnerEventSequence }
            : {}),
          nodeId: options.nodeId,
          ...(output ? { output } : {}),
          status,
          testId: options.executionId,
          timestamp: new Date(now()).toISOString(),
          type: 'runner_status',
        },
        options.config.protocolToken,
      );
      await publish(
        payload,
        status === 'completed' ? 'runner_result' : 'runner_status',
        'runner_status',
      );
    },
    waitForStartPayload: async () => {
      const signal = await waitForControlSignal('payload');
      return signal.action === 'cancel'
        ? signal
        : { action: 'start', payload: signal.payload! };
    },
    waitForStartSignal: async () =>
      (await waitForControlSignal('signal')).action,
  };
}
