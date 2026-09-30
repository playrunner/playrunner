import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inspectLocalExecution,
  stopLocalExecution,
  type ExecutionControlDependencies,
} from './execution-control';

function fixture(owner: 'running' | 'stopping' | 'absent' = 'running') {
  const stopped: string[] = [];
  let containers = ['aaaaaaaaaaaa'];
  const deps: ExecutionControlDependencies = {
    orchestrator: async (_id, stop) => (stop ? 'stopping' : owner),
    containers: async () => containers,
    stopContainer: async (id) => {
      stopped.push(id);
      containers = containers.filter((item) => item !== id);
    },
  };
  return { deps, stopped };
}
test('distinguishes tracked, orphaned, inactive and unreachable runs', async () => {
  for (const [owner, expected] of [
    ['running', 'running'],
    ['stopping', 'stopping'],
    ['absent', 'orphaned'],
  ] as const) {
    assert.equal(
      (await inspectLocalExecution('run', fixture(owner).deps)).state,
      expected,
    );
  }
  const { deps } = fixture('absent');
  deps.containers = async () => [];
  assert.equal((await inspectLocalExecution('run', deps)).state, 'inactive');
  deps.orchestrator = async () => {
    throw new Error('offline');
  };
  assert.equal((await inspectLocalExecution('run', deps)).state, 'unknown');
  deps.containers = async () => {
    throw new Error('Docker offline');
  };
  assert.equal((await inspectLocalExecution('run', deps)).runnerCount, null);
});
test('closes scheduler before stopping execution containers and verifies absence', async () => {
  const { deps, stopped } = fixture('absent');
  let gated = false;
  deps.orchestrator = async (_id, stop) => {
    if (stop) gated = true;
    return 'absent';
  };
  const stop = deps.stopContainer;
  deps.stopContainer = async (id) => {
    assert.equal(gated, true);
    await stop(id);
  };
  assert.equal((await stopLocalExecution('run', deps)).state, 'inactive');
  assert.deepEqual(stopped, ['aaaaaaaaaaaa']);
});
test('does not kill children or declare cancellation if scheduler cannot be stopped', async () => {
  const { deps, stopped } = fixture();
  deps.orchestrator = async () => {
    throw new Error('unreachable');
  };
  await assert.rejects(stopLocalExecution('run', deps), /unreachable/);
  assert.deepEqual(stopped, []);
});
test('failed kill remains retryable and is never reported inactive', async () => {
  const { deps } = fixture('absent');
  deps.stopContainer = async () => {
    throw new Error('kill failed');
  };
  await assert.rejects(stopLocalExecution('run', deps), /still active/);
});
