import type { RunnerControlConfig } from './runner-control';

export const AGENT_BOOTSTRAP_ENVIRONMENT_VARIABLE =
  'PLAYRUNNER_AGENT_BOOTSTRAP';
export const MAX_AGENT_BOOTSTRAP_BYTES = 32 * 1024;

export type AgentBootstrap = {
  executionId: string;
  gcpAccessToken: string;
  nodeId: string;
  runnerControl: RunnerControlConfig;
};

export function serializeAgentBootstrap(value: AgentBootstrap): string {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_AGENT_BOOTSTRAP_BYTES) {
    throw new Error('AI Container bootstrap is too large.');
  }
  return serialized;
}
