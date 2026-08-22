import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalExecutePayloadHash,
  ExecuteIdempotencyRegistry,
  ExecuteRequestCoordinator,
} from './execute-idempotency';

test('canonical payload hashes do not depend on JSON object key order', () => {
  assert.equal(
    canonicalExecutePayloadHash({
      nodes: [{ config: { b: 2, a: 1 }, id: 'node-1' }],
      testId: 'execution-1',
    }),
    canonicalExecutePayloadHash({
      testId: 'execution-1',
      nodes: [{ id: 'node-1', config: { a: 1, b: 2 } }],
    }),
  );
});

test('acknowledges an exact duplicate without executing it twice', async () => {
  const payload = {
    nodes: [{ id: 'node-1' }],
    testId: 'execution-duplicate',
  };
  let executionCount = 0;
  const coordinator = new ExecuteRequestCoordinator(
    async () => {
      executionCount++;
    },
    () => assert.fail('execution should not fail'),
  );

  const first = coordinator.admit(payload);
  const duplicateWhileRunning = coordinator.admit({
    testId: 'execution-duplicate',
    nodes: [{ id: 'node-1' }],
  });

  assert.equal(first.statusCode, 200);
  assert.deepEqual(duplicateWhileRunning, {
    body: {
      executionState: 'running',
      status: 'already_started',
      testId: 'execution-duplicate',
    },
    statusCode: 200,
  });
  assert.equal(executionCount, 0);

  await first.start?.();
  await first.start?.();
  assert.equal(executionCount, 1);

  assert.deepEqual(coordinator.admit(payload), {
    body: {
      executionState: 'terminal',
      status: 'already_started',
      testId: 'execution-duplicate',
    },
    statusCode: 200,
  });
  assert.equal(executionCount, 1);
});

test('rejects a reused execution ID when the canonical payload changes', () => {
  const coordinator = new ExecuteRequestCoordinator(
    async () => assert.fail('execution is launched only after start'),
    () => undefined,
  );

  assert.equal(
    coordinator.admit({ nodes: [], testId: 'execution-conflict' }).statusCode,
    200,
  );
  assert.deepEqual(
    coordinator.admit({
      nodes: [{ id: 'unexpected-node' }],
      testId: 'execution-conflict',
    }),
    {
      body: {
        error:
          'An execution with this testId was already admitted with a different payload.',
        testId: 'execution-conflict',
      },
      statusCode: 409,
    },
  );
});

test('validates the exact execution identity before admitting work', () => {
  const coordinator = new ExecuteRequestCoordinator(
    async () => assert.fail('invalid work must not execute'),
    () => undefined,
  );

  assert.equal(coordinator.admit({ nodes: [] }).statusCode, 400);
  assert.equal(
    coordinator.admit({ nodes: [], testId: ' execution-spaced ' }).statusCode,
    400,
  );
  assert.equal(
    coordinator.admit({
      executionId: 'different-execution',
      nodes: [],
      testId: 'execution-id',
    }).statusCode,
    400,
  );
  assert.equal(
    coordinator.admit({
      executionId: 'execution-id',
      nodes: [],
      testId: 'execution-id',
    }).statusCode,
    200,
  );
});

test('bounds running admissions and evicts the oldest terminal admission', () => {
  let now = 0;
  const registry = new ExecuteIdempotencyRegistry({
    maxEntries: 2,
    now: () => now,
    terminalRetentionMs: 1_000,
  });

  const first = registry.reserve({ testId: 'execution-1' });
  assert.equal(first.kind, 'reserved');
  if (first.kind !== 'reserved') assert.fail('first reservation failed');
  registry.markTerminal(first.executionId, first.payloadHash);

  now++;
  const second = registry.reserve({ testId: 'execution-2' });
  assert.equal(second.kind, 'reserved');
  if (second.kind !== 'reserved') assert.fail('second reservation failed');
  registry.markTerminal(second.executionId, second.payloadHash);

  now++;
  assert.equal(registry.reserve({ testId: 'execution-3' }).kind, 'reserved');
  assert.equal(registry.entryCount, 2);
  assert.equal(registry.reserve({ testId: 'execution-1' }).kind, 'reserved');
  assert.equal(registry.entryCount, 2);

  const runningOnlyRegistry = new ExecuteIdempotencyRegistry({
    maxEntries: 1,
  });
  assert.equal(
    runningOnlyRegistry.reserve({ testId: 'running-1' }).kind,
    'reserved',
  );
  assert.equal(
    runningOnlyRegistry.reserve({ testId: 'running-2' }).kind,
    'capacity',
  );
});

test('rejects admission-capacity exhaustion before acknowledging execution', () => {
  let executionCount = 0;
  const coordinator = new ExecuteRequestCoordinator(
    async () => {
      executionCount++;
    },
    () => undefined,
    new ExecuteIdempotencyRegistry({ maxEntries: 1 }),
  );

  assert.equal(coordinator.admit({ testId: 'running-1' }).statusCode, 200);
  assert.deepEqual(coordinator.admit({ testId: 'running-2' }), {
    body: {
      error: 'Orchestrator execution admission capacity is exhausted.',
      testId: 'running-2',
    },
    statusCode: 409,
  });
  assert.equal(executionCount, 0);
});

test('expires terminal admissions after the bounded retention window', () => {
  let now = 0;
  const registry = new ExecuteIdempotencyRegistry({
    now: () => now,
    terminalRetentionMs: 100,
  });
  const reservation = registry.reserve({ testId: 'execution-expiring' });
  assert.equal(reservation.kind, 'reserved');
  if (reservation.kind !== 'reserved') assert.fail('reservation failed');
  registry.markTerminal(reservation.executionId, reservation.payloadHash);

  assert.equal(
    registry.reserve({ testId: 'execution-expiring' }).kind,
    'duplicate',
  );
  now = 100;
  assert.equal(
    registry.reserve({ testId: 'execution-expiring' }).kind,
    'reserved',
  );
});

test('marks failed executions terminal while containing error callbacks', async () => {
  const observedErrors: unknown[] = [];
  const coordinator = new ExecuteRequestCoordinator(
    async () => {
      throw new Error('workflow failed');
    },
    (error) => {
      observedErrors.push(error);
      throw new Error('logger failed');
    },
  );

  const admission = coordinator.admit({ testId: 'execution-failed' });
  await admission.start?.();

  assert.equal(observedErrors.length, 1);
  assert.equal(
    (coordinator.admit({ testId: 'execution-failed' }).body as any)
      .executionState,
    'terminal',
  );
});
