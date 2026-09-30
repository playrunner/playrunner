import {
  executionContainers,
  stopExecutionContainer,
} from '../../../runners/shared/local-execution-containers';
import { ORCHESTRATOR_URL } from '../config';
import { getLocalOrchestratorRequestHeaders } from '../runtime/orchestrator-runner';

type OrchestratorStatus = 'running' | 'stopping' | 'absent';
export type ExecutionControlDependencies = {
  orchestrator: (id: string, stop: boolean) => Promise<OrchestratorStatus>;
  containers: (id: string) => Promise<string[]>;
  stopContainer: (id: string) => Promise<void>;
};
const dependencies: ExecutionControlDependencies = {
  async orchestrator(id, stop) {
    const response = await fetch(
      `${ORCHESTRATOR_URL}/executions/${encodeURIComponent(id)}${stop ? '/stop' : ''}`,
      {
        method: stop ? 'POST' : 'GET',
        headers: getLocalOrchestratorRequestHeaders(),
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!response.ok) throw new Error('Orchestrator control unavailable.');
    const body = await response.json();
    if (!['running', 'stopping', 'absent'].includes(body.status))
      throw new Error('Invalid orchestrator response.');
    return body.status;
  },
  containers: executionContainers,
  stopContainer: stopExecutionContainer,
};

export async function inspectLocalExecution(id: string, deps = dependencies) {
  const [orchestrator, containers] = await Promise.allSettled([
    deps.orchestrator(id, false),
    deps.containers(id),
  ]);
  const owner =
    orchestrator.status === 'fulfilled' ? orchestrator.value : 'unknown';
  const runnerCount =
    containers.status === 'fulfilled' ? containers.value.length : null;
  const state =
    owner === 'stopping'
      ? 'stopping'
      : owner === 'running'
        ? 'running'
        : owner === 'absent' && runnerCount === 0
          ? 'inactive'
          : owner === 'absent' && runnerCount !== null
            ? 'orphaned'
            : 'unknown';
  return { state, runnerCount, checkedAt: new Date().toISOString() };
}

export async function stopLocalExecution(id: string, deps = dependencies) {
  // An unreachable/old orchestrator cannot confirm the scheduling gate closed.
  // Do not claim cancellation or kill children while it may launch more work.
  await deps.orchestrator(id, true);
  const containers = await deps.containers(id);
  const stopped = await Promise.allSettled(containers.map(deps.stopContainer));
  const remaining = await deps.containers(id);
  if (
    remaining.length ||
    stopped.some((result) => result.status === 'rejected')
  ) {
    // A runner may have exited normally between inventory and stop.
    if (remaining.length)
      throw new Error(
        'Some runners are still active. Retry stopping this run.',
      );
  }
  return inspectLocalExecution(id, deps);
}
