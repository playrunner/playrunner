import type { Readable } from 'node:stream';
import {
  createRunnerControlClient,
  type RunnerControlClient,
} from '../../shared/runner-control';
import { isRunnerProtocolToken } from '../../shared/runner-protocol';
import {
  AGENT_BOOTSTRAP_ENVIRONMENT_VARIABLE,
  MAX_AGENT_BOOTSTRAP_BYTES,
  type AgentBootstrap,
} from '../../shared/agent-bootstrap';
import {
  parseAgentPayload,
  readAgentPayload,
  type AgentRunnerPayload,
} from './payload';

export { AGENT_BOOTSTRAP_ENVIRONMENT_VARIABLE, MAX_AGENT_BOOTSTRAP_BYTES };
export type { AgentBootstrap };

export type LoadedAgentPayload =
  | { action: 'cancel' }
  | { action: 'start'; payload: AgentRunnerPayload };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  const allowedKeys = new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unexpected) {
    throw new Error(`AI Container ${field}.${unexpected} is not supported.`);
  }
}

function requiredIdentifier(value: unknown, field: string): string {
  const identifier = typeof value === 'string' ? value.trim() : '';
  if (
    !identifier ||
    identifier.length > 255 ||
    Array.from(identifier).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw new Error(`AI Container bootstrap ${field} is invalid.`);
  }
  return identifier;
}

function requiredPubSubSegment(value: unknown, field: string): string {
  const segment = requiredIdentifier(value, `runnerControl.${field}`);
  if (segment.includes('/') || segment.includes('\\')) {
    throw new Error(
      `AI Container bootstrap runnerControl.${field} is invalid.`,
    );
  }
  return segment;
}

export function parseAgentBootstrap(raw: string): AgentBootstrap {
  if (!raw || Buffer.byteLength(raw, 'utf8') > MAX_AGENT_BOOTSTRAP_BYTES) {
    throw new Error('AI Container bootstrap is missing or too large.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('AI Container bootstrap is not valid JSON.');
  }
  const bootstrap = record(parsed);
  assertOnlyKeys(
    bootstrap,
    ['executionId', 'gcpAccessToken', 'nodeId', 'runnerControl'],
    'bootstrap',
  );
  const runnerControl = record(bootstrap.runnerControl);
  assertOnlyKeys(
    runnerControl,
    [
      'controlSubscriptionName',
      'projectId',
      'protocolToken',
      'topicName',
      'type',
    ],
    'bootstrap.runnerControl',
  );
  if (runnerControl.type !== 'gcp_pubsub') {
    throw new Error(
      'AI Container bootstrap runnerControl.type must be gcp_pubsub.',
    );
  }
  if (!isRunnerProtocolToken(runnerControl.protocolToken)) {
    throw new Error(
      'AI Container bootstrap runnerControl.protocolToken is invalid.',
    );
  }
  const gcpAccessToken =
    typeof bootstrap.gcpAccessToken === 'string'
      ? bootstrap.gcpAccessToken.trim()
      : '';
  if (
    !gcpAccessToken ||
    gcpAccessToken.length > 16 * 1024 ||
    gcpAccessToken.includes('\0')
  ) {
    throw new Error('AI Container bootstrap gcpAccessToken is invalid.');
  }
  return {
    executionId: requiredIdentifier(bootstrap.executionId, 'executionId'),
    gcpAccessToken,
    nodeId: requiredIdentifier(bootstrap.nodeId, 'nodeId'),
    runnerControl: {
      controlSubscriptionName: requiredPubSubSegment(
        runnerControl.controlSubscriptionName,
        'controlSubscriptionName',
      ),
      projectId: requiredPubSubSegment(runnerControl.projectId, 'projectId'),
      protocolToken: runnerControl.protocolToken,
      topicName: requiredPubSubSegment(runnerControl.topicName, 'topicName'),
      type: 'gcp_pubsub',
    },
  };
}

export function consumeAgentBootstrapEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): AgentBootstrap | undefined {
  const raw = environment[AGENT_BOOTSTRAP_ENVIRONMENT_VARIABLE];
  // Delete before parsing or performing any asynchronous work so neither the
  // repository nor the Codex child can inherit the bootstrap credentials.
  delete environment[AGENT_BOOTSTRAP_ENVIRONMENT_VARIABLE];
  return raw === undefined ? undefined : parseAgentBootstrap(raw);
}

function assertPayloadMatchesBootstrap(
  payload: AgentRunnerPayload,
  bootstrap: AgentBootstrap,
): void {
  const control = payload.runnerControl;
  if (
    payload.runtime.testId !== bootstrap.executionId ||
    payload.runtime.nodeId !== bootstrap.nodeId ||
    payload.gcpAccessToken !== bootstrap.gcpAccessToken ||
    control.type !== bootstrap.runnerControl.type ||
    control.controlSubscriptionName !==
      bootstrap.runnerControl.controlSubscriptionName ||
    control.projectId !== bootstrap.runnerControl.projectId ||
    control.protocolToken !== bootstrap.runnerControl.protocolToken ||
    control.topicName !== bootstrap.runnerControl.topicName
  ) {
    throw new Error(
      'Signed AI Container payload does not match its Cloud Run bootstrap identity.',
    );
  }
}

export async function loadAgentPayload(
  options: {
    createControlClient?: typeof createRunnerControlClient;
    environment?: NodeJS.ProcessEnv;
    input?: Readable;
  } = {},
): Promise<LoadedAgentPayload> {
  const bootstrap = consumeAgentBootstrapEnvironment(options.environment);
  if (!bootstrap) {
    return {
      action: 'start',
      payload: await readAgentPayload(options.input),
    };
  }

  const control: RunnerControlClient = (
    options.createControlClient || createRunnerControlClient
  )({
    config: bootstrap.runnerControl,
    executionId: bootstrap.executionId,
    gcpAccessToken: bootstrap.gcpAccessToken,
    logPrefix: '[AI Container]',
    nodeId: bootstrap.nodeId,
    runnerName: 'AI Container',
  });
  try {
    const signal = await control.waitForStartPayload();
    if (signal.action === 'cancel') {
      await control.publishStatus('cancelled');
      return signal;
    }
    const payload = parseAgentPayload({
      ...signal.payload,
      gcpAccessToken: bootstrap.gcpAccessToken,
      runnerControl: bootstrap.runnerControl,
    });
    assertPayloadMatchesBootstrap(payload, bootstrap);
    return { action: 'start', payload };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await control.publishStatus('prepare_failed', message).catch(() => {});
    throw error;
  }
}
