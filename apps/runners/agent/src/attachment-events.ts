import type {
  RunnerControlClient,
  RunnerEventIdentity,
} from '../../shared/runner-control';
import type { SupervisorProgressEvent, SupervisorResult } from './supervisor';

export type AgentAttachmentEvents = {
  agent: RunnerEventIdentity;
  validators: RunnerEventIdentity[];
};

export function createAgentAttachmentEvents(input: {
  agentNodeId: string;
  containerNodeId: string;
  validatorNodeIds: string[];
}): AgentAttachmentEvents {
  const identity = (nodeId: string): RunnerEventIdentity => ({
    nodeId,
    parentNodeId: input.containerNodeId,
  });
  return {
    agent: identity(input.agentNodeId),
    validators: input.validatorNodeIds.map(identity),
  };
}

async function setValidatorState(
  runnerControl: RunnerControlClient,
  attachments: AgentAttachmentEvents,
  state: 'error' | 'pending' | 'running' | 'success' | 'warning',
): Promise<void> {
  await Promise.all(
    attachments.validators.map((validator) =>
      runnerControl.publishNodeState(state, validator),
    ),
  );
}

async function logForValidators(
  runnerControl: RunnerControlClient,
  attachments: AgentAttachmentEvents,
  message: string,
): Promise<void> {
  await Promise.all(
    attachments.validators.map((validator) =>
      runnerControl.log(message, 'info', validator),
    ),
  );
}

export async function publishAttachmentPending(
  runnerControl: RunnerControlClient,
  attachments: AgentAttachmentEvents,
): Promise<void> {
  await Promise.all([
    runnerControl.publishNodeState('pending', attachments.agent),
    setValidatorState(runnerControl, attachments, 'pending'),
  ]);
}

export async function publishAttachmentCancelled(
  runnerControl: RunnerControlClient,
  attachments: AgentAttachmentEvents,
): Promise<void> {
  await Promise.all([
    runnerControl.publishNodeState('warning', attachments.agent),
    setValidatorState(runnerControl, attachments, 'warning'),
  ]);
}

export async function publishAttachmentFailure(
  runnerControl: RunnerControlClient,
  attachments: AgentAttachmentEvents,
  message: string,
): Promise<void> {
  await Promise.all([
    runnerControl.log(message, 'error', attachments.agent),
    ...attachments.validators.map((validator) =>
      runnerControl.log(message, 'error', validator),
    ),
  ]);
  await Promise.all([
    runnerControl.publishNodeState('error', attachments.agent),
    setValidatorState(runnerControl, attachments, 'error'),
  ]);
}

export async function publishSupervisorProgress(
  runnerControl: RunnerControlClient,
  attachments: AgentAttachmentEvents,
  event: SupervisorProgressEvent,
): Promise<void> {
  await runnerControl.log(event.message);
  if (event.stage === 'agent') {
    if (event.attempt > 1) {
      await setValidatorState(runnerControl, attachments, 'error');
      await setValidatorState(runnerControl, attachments, 'pending');
    }
    await runnerControl.publishNodeState('running', attachments.agent);
    await runnerControl.log(event.message, 'info', attachments.agent);
    return;
  }
  if (event.stage === 'validation') {
    await runnerControl.publishNodeState('success', attachments.agent);
    await setValidatorState(runnerControl, attachments, 'running');
    await logForValidators(runnerControl, attachments, event.message);
    return;
  }
  await Promise.all([
    runnerControl.log(event.message, 'info', attachments.agent),
    logForValidators(runnerControl, attachments, event.message),
  ]);
}

export async function publishAttachmentOutcome(
  runnerControl: RunnerControlClient,
  attachments: AgentAttachmentEvents,
  supervisor: SupervisorResult,
): Promise<void> {
  const agentFailed = supervisor.stopReason === 'agent_failed';
  await runnerControl.publishNodeState(
    agentFailed ? 'error' : 'success',
    attachments.agent,
  );
  await setValidatorState(
    runnerControl,
    attachments,
    supervisor.status === 'passed' ? 'success' : 'error',
  );
}

export async function publishValidatorAttachmentOutput(
  runnerControl: RunnerControlClient,
  attachments: AgentAttachmentEvents,
  output: Record<string, unknown>,
): Promise<void> {
  await Promise.all(
    attachments.validators.map((validator) =>
      runnerControl.publishEvent({ output, type: 'node_output' }, validator),
    ),
  );
}
