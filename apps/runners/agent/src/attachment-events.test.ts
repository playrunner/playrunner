import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  RunnerControlClient,
  RunnerEventIdentity,
} from '../../shared/runner-control';
import {
  createAgentAttachmentEvents,
  publishAttachmentOutcome,
  publishAttachmentPending,
  publishSupervisorProgress,
  publishValidatorAttachmentOutput,
} from './attachment-events';
import type { SupervisorResult } from './supervisor';

function recorder() {
  const events: Array<{
    identity?: RunnerEventIdentity;
    kind: 'event' | 'log' | 'state';
    value: unknown;
  }> = [];
  const control: RunnerControlClient = {
    log: async (message, _level, identity) => {
      events.push({ identity, kind: 'log', value: message });
    },
    publishNodeState: async (state, identity) => {
      events.push({ identity, kind: 'state', value: state });
    },
    publishEvent: async (event, identity) => {
      events.push({ identity, kind: 'event', value: event });
    },
    publishStatus: async () => {},
    waitForStartPayload: async () => ({ action: 'start', payload: {} }),
    waitForStartSignal: async () => 'start',
  };
  return { control, events };
}

function failedSupervisor(): SupervisorResult {
  return {
    attemptHistory: [],
    attempts: 0,
    completedAt: '2026-08-21T00:00:01.000Z',
    durationMs: 1,
    schemaVersion: '1.0',
    startedAt: '2026-08-21T00:00:00.000Z',
    status: 'failed',
    stopReason: 'agent_failed',
    validation: null,
  };
}

test('emits pending state for the stable attached node identities', async () => {
  const { control, events } = recorder();
  const attachments = createAgentAttachmentEvents({
    agentNodeId: 'agent-child',
    containerNodeId: 'container-parent',
    validatorNodeIds: ['validator-a', 'validator-b'],
  });

  await publishAttachmentPending(control, attachments);

  assert.deepEqual(
    events.map((event) => event.identity),
    [
      { nodeId: 'agent-child', parentNodeId: 'container-parent' },
      { nodeId: 'validator-a', parentNodeId: 'container-parent' },
      { nodeId: 'validator-b', parentNodeId: 'container-parent' },
    ],
  );
  assert.ok(events.every((event) => event.value === 'pending'));
});

test('maps supervisor stages and failures onto Agent and Validator children', async () => {
  const { control, events } = recorder();
  const attachments = createAgentAttachmentEvents({
    agentNodeId: 'agent-child',
    containerNodeId: 'container-parent',
    validatorNodeIds: ['validator-child'],
  });

  await publishSupervisorProgress(control, attachments, {
    attempt: 1,
    maximumAttempts: 3,
    message: 'Agent attempt 1 of 3.',
    stage: 'agent',
  });
  await publishSupervisorProgress(control, attachments, {
    attempt: 1,
    maximumAttempts: 3,
    message: 'Running authoritative validation.',
    stage: 'validation',
  });
  await publishAttachmentOutcome(control, attachments, failedSupervisor());

  assert.ok(
    events.some(
      (event) =>
        event.kind === 'state' &&
        event.identity?.nodeId === 'agent-child' &&
        event.value === 'running',
    ),
  );
  assert.ok(
    events.some(
      (event) =>
        event.kind === 'state' &&
        event.identity?.nodeId === 'validator-child' &&
        event.value === 'running',
    ),
  );
  assert.ok(
    events.some(
      (event) =>
        event.kind === 'state' &&
        event.identity?.nodeId === 'agent-child' &&
        event.value === 'error',
    ),
  );
  assert.ok(
    events.some(
      (event) =>
        event.kind === 'log' &&
        event.identity?.nodeId === 'validator-child' &&
        /validation/.test(String(event.value)),
    ),
  );
});

test('publishes final validation output for every attached validator', async () => {
  const { control, events } = recorder();
  const attachments = createAgentAttachmentEvents({
    agentNodeId: 'agent-child',
    containerNodeId: 'container-parent',
    validatorNodeIds: ['validator-a', 'validator-b'],
  });
  const output = {
    artifacts: {
      validationReport: '/outputs/run/container/validation/final.json',
    },
    attempts: 3,
    status: 'failed',
    stopReason: 'max_attempts',
    validation: { passed: false, status: 'failed' },
  };

  await publishValidatorAttachmentOutput(control, attachments, output);

  assert.deepEqual(events, [
    {
      identity: {
        nodeId: 'validator-a',
        parentNodeId: 'container-parent',
      },
      kind: 'event',
      value: { output, type: 'node_output' },
    },
    {
      identity: {
        nodeId: 'validator-b',
        parentNodeId: 'container-parent',
      },
      kind: 'event',
      value: { output, type: 'node_output' },
    },
  ]);
});
