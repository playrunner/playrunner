import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import {
  executeIdempotentMachineRun as executeRun,
  machineRunRequestHash,
  parseMachineIdempotencyKey,
} from './machine-run-idempotency';

test('keys are bounded and fingerprints ignore input field order', () => {
  assert.equal(parseMachineIdempotencyKey(undefined), undefined);
  for (const key of ['', ' ', 'x'.repeat(201)])
    assert.throws(() => parseMachineIdempotencyKey(key));
  assert.equal(
    machineRunRequestHash({ a: '1', b: '2' }, []),
    machineRunRequestHash({ b: '2', a: '1' }, []),
  );
  assert.notEqual(
    machineRunRequestHash({ a: '1' }, []),
    machineRunRequestHash({ a: '2' }, []),
  );
});

test('concurrent retries, conflicts, failures and token isolation', async (t) => {
  const database = {
    workflowMachineExecution: {
      create() {},
      findUniqueOrThrow() {},
      update() {},
    },
    workflowExecution: { findUnique() {} },
  };
  const executeIdempotentMachineRun = (
    params: Parameters<typeof executeRun>[0],
  ) => executeRun(params, database as unknown as typeof prisma);
  const rows = new Map<string, any>();
  const executions = new Map<string, { status: string }>();
  const key = (data: any) =>
    JSON.stringify([data.apiTokenId, data.workflowId, data.idempotencyKey]);
  t.mock.method(
    database.workflowMachineExecution,
    'create',
    async ({ data }: any) => {
      if (rows.has(key(data)))
        throw Object.assign(new Error('duplicate'), { code: 'P2002' });
      const row = { ...data, id: key(data), httpStatus: null, response: null };
      rows.set(key(data), row);
      return row;
    },
  );
  t.mock.method(
    database.workflowMachineExecution,
    'findUniqueOrThrow',
    async ({ where }: any) =>
      rows.get(key(where.apiTokenId_workflowId_idempotencyKey)),
  );
  t.mock.method(
    database.workflowMachineExecution,
    'update',
    async ({ where, data }: any) => Object.assign(rows.get(where.id), data),
  );
  t.mock.method(
    database.workflowExecution,
    'findUnique',
    async ({ where }: any) => executions.get(where.id) ?? null,
  );
  let starts = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const params = {
    apiTokenId: 't1',
    workflowId: 'w1',
    idempotencyKey: 'key',
    requestHash: 'hash',
    start: async (executionId: string) => {
      starts++;
      await gate;
      return { status: 202, body: { executionId, status: 'running' } };
    },
  };
  const first = executeIdempotentMachineRun(params);
  const replay = await executeIdempotentMachineRun(params);
  assert.equal(replay.body.deduplicated, true);
  assert.equal(replay.body.status, 'starting');
  assert.equal(starts, 1);
  release();
  const original = await first;
  assert.equal(original.body.executionId, replay.body.executionId);
  assert.equal(
    (await executeIdempotentMachineRun({ ...params, requestHash: 'changed' }))
      .status,
    409,
  );
  executions.set(original.body.executionId as string, { status: 'completed' });
  assert.equal(
    (await executeIdempotentMachineRun(params)).body.status,
    'completed',
  );
  assert.equal(starts, 1);
  await executeIdempotentMachineRun({ ...params, apiTokenId: 't2' });
  assert.equal(starts, 2);
  await executeIdempotentMachineRun({ ...params, workflowId: 'w2' });
  assert.equal(starts, 3);
  await executeIdempotentMachineRun({ ...params, idempotencyKey: undefined });
  await executeIdempotentMachineRun({ ...params, idempotencyKey: undefined });
  assert.equal(starts, 5);
  const failure = {
    ...params,
    idempotencyKey: 'failure',
    start: async () => {
      starts++;
      return { status: 503, body: { error: 'unavailable' } };
    },
  };
  await executeIdempotentMachineRun(failure);
  assert.equal((await executeIdempotentMachineRun(failure)).status, 503);
  assert.equal(starts, 6);
});
