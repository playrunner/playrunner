import assert from 'node:assert/strict';
import test from 'node:test';
import type { RunnerControlClient } from '../../shared/runner-control';
import {
  AGENT_BOOTSTRAP_ENVIRONMENT_VARIABLE,
  consumeAgentBootstrapEnvironment,
  loadAgentPayload,
} from './bootstrap';

const PROTOCOL_TOKEN = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function bootstrap() {
  return {
    executionId: 'execution-1',
    gcpAccessToken: 'gcp-bootstrap-token',
    nodeId: 'agent-container',
    runnerControl: {
      controlSubscriptionName: 'agent-control',
      projectId: 'test-project',
      protocolToken: PROTOCOL_TOKEN,
      topicName: 'workflow-events',
      type: 'gcp_pubsub',
    },
  } as const;
}

function transportedPayload(): Record<string, unknown> {
  return {
    agent: { config: {}, nodeId: 'codex-agent', nodeType: 'codex-cli' },
    config: {},
    environment: { MODEL_KEY: 'openai-secret' },
    github: { accessToken: 'github-secret' },
    runtime: {
      cloudProvider: 'GCP',
      editorApiUrl: 'https://editor.test',
      executionAuthToken: 'execution-auth',
      nodeId: 'agent-container',
      testId: 'execution-1',
      workflowId: 'workflow-1',
    },
    validators: [
      { config: {}, nodeId: 'test-validator', nodeType: 'validator' },
    ],
  };
}

function fakeControl(
  signal:
    | { action: 'cancel' }
    | { action: 'start'; payload: Record<string, unknown> },
  statuses: string[],
): RunnerControlClient {
  return {
    log: async () => {},
    publishEvent: async () => {},
    publishNodeState: async () => {},
    publishStatus: async (status) => {
      statuses.push(status);
    },
    waitForStartPayload: async () => signal,
    waitForStartSignal: async () => signal.action,
  };
}

test('deletes hosted bootstrap credentials before requesting the signed payload', async () => {
  const environment: NodeJS.ProcessEnv = {
    [AGENT_BOOTSTRAP_ENVIRONMENT_VARIABLE]: JSON.stringify(bootstrap()),
  };
  const statuses: string[] = [];
  const loaded = await loadAgentPayload({
    createControlClient: (options) => {
      assert.equal(
        environment[AGENT_BOOTSTRAP_ENVIRONMENT_VARIABLE],
        undefined,
      );
      assert.equal(options.gcpAccessToken, 'gcp-bootstrap-token');
      return fakeControl(
        { action: 'start', payload: transportedPayload() },
        statuses,
      );
    },
    environment,
  });

  assert.equal(loaded.action, 'start');
  if (loaded.action !== 'start') return;
  assert.equal(loaded.payload.gcpAccessToken, 'gcp-bootstrap-token');
  assert.deepEqual(loaded.payload.runnerControl, bootstrap().runnerControl);
  assert.equal(loaded.payload.github?.accessToken, 'github-secret');
  assert.deepEqual(statuses, []);
});

test('deletes malformed bootstrap credentials before validation fails', () => {
  const environment: NodeJS.ProcessEnv = {
    [AGENT_BOOTSTRAP_ENVIRONMENT_VARIABLE]: '{not-json',
  };

  assert.throws(
    () => consumeAgentBootstrapEnvironment(environment),
    /not valid JSON/,
  );
  assert.equal(environment[AGENT_BOOTSTRAP_ENVIRONMENT_VARIABLE], undefined);
});

test('publishes cancellation without waiting for the full hosted payload', async () => {
  const statuses: string[] = [];
  const loaded = await loadAgentPayload({
    createControlClient: () => fakeControl({ action: 'cancel' }, statuses),
    environment: {
      [AGENT_BOOTSTRAP_ENVIRONMENT_VARIABLE]: JSON.stringify(bootstrap()),
    },
  });

  assert.deepEqual(loaded, { action: 'cancel' });
  assert.deepEqual(statuses, ['cancelled']);
});

test('fails closed when the signed payload identity differs from bootstrap', async () => {
  const statuses: string[] = [];
  const payload = transportedPayload();
  (payload.runtime as Record<string, unknown>).testId = 'another-execution';

  await assert.rejects(
    () =>
      loadAgentPayload({
        createControlClient: () =>
          fakeControl({ action: 'start', payload }, statuses),
        environment: {
          [AGENT_BOOTSTRAP_ENVIRONMENT_VARIABLE]: JSON.stringify(bootstrap()),
        },
      }),
    /does not match.*bootstrap identity/,
  );
  assert.deepEqual(statuses, ['prepare_failed']);
});
