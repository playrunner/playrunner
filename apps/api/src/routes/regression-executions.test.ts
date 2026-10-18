import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import type { prisma as PrismaInstance } from '../lib/prisma';

test('regression HTTP runs enforce saved mappings, ownership and retry scope', async (t) => {
  const unexpected = async () => {
    throw new Error('Unexpected database access');
  };
  const database = {
    workflow: { findFirst: unexpected, findUnique: unexpected },
    workflowExecution: { findUnique: unexpected },
    workflowMachineExecution: {
      create: unexpected,
      update: unexpected,
      findUniqueOrThrow: unexpected,
    },
  };
  const previous = globalThis.prisma;
  globalThis.prisma = database as unknown as typeof PrismaInstance;
  t.after(() => {
    globalThis.prisma = previous;
  });
  const { apiTokens } = await import('../services/api-tokens');
  const request = {
    version: 1,
    mode: 'affected',
    sources: [
      {
        repository: 'example/ui',
        baseSha: 'a'.repeat(40),
        headSha: 'b'.repeat(40),
      },
    ],
  };
  const workflow = {
    id: 'regression-workflow',
    userId: 'owner',
    title: 'Shared component checks',
    cloudProvider: 'LOCAL_RUNNER',
    concurrency: null,
    connections: [],
    nodes: [
      {
        id: 'checks',
        nodeType: 'playwright',
        config: {
          repository: 'example/ui',
          regression: {
            version: 1,
            repositories: [{ repository: 'example/ui' }],
            dependencies: [],
            journeys: [
              {
                id: 'settings',
                title: 'Settings',
                sources: [{ repository: 'example/ui', path: 'src/select.ts' }],
                tests: [{ file: 'tests/settings.spec.ts' }],
              },
            ],
          },
        },
      },
    ],
  };
  t.mock.method(apiTokens, 'authenticate', async (key: string) =>
    key === 'missing'
      ? null
      : {
          id: key,
          userId: key === 'other-owner' ? 'other-owner' : 'owner',
          scopes:
            key === 'write-only' ? ['workflow:write'] : ['workflow:execute'],
          allowedWorkflowIds: key === 'restricted' ? ['another-workflow'] : [],
        },
  );
  t.mock.method(apiTokens, 'auditExecution', async () => undefined);
  const { apiRuntime } = await import('../runtime');
  const { machineExecutionsRouter } = await import('./machine-executions');
  t.mock.method(database.workflow, 'findFirst', async ({ where }: any) =>
    where.id === workflow.id && where.userId === workflow.userId
      ? workflow
      : null,
  );
  t.mock.method(database.workflow, 'findUnique', async ({ where }: any) =>
    where.id === workflow.id ? workflow : null,
  );
  t.mock.method(database.workflowExecution, 'findUnique', async () => null);
  const reservations = new Map<string, any>();
  const reservationKey = (value: any) =>
    JSON.stringify([value.apiTokenId, value.workflowId, value.idempotencyKey]);
  t.mock.method(
    database.workflowMachineExecution,
    'create',
    async ({ data }: any) => {
      const id = reservationKey(data);
      if (reservations.has(id))
        throw Object.assign(new Error('Duplicate'), { code: 'P2002' });
      const row = { ...data, id, httpStatus: null, response: null };
      reservations.set(id, row);
      return row;
    },
  );
  t.mock.method(
    database.workflowMachineExecution,
    'findUniqueOrThrow',
    async ({ where }: any) =>
      reservations.get(
        reservationKey(where.apiTokenId_workflowId_idempotencyKey),
      ),
  );
  t.mock.method(
    database.workflowMachineExecution,
    'update',
    async ({ where, data }: any) =>
      Object.assign(reservations.get(where.id), data),
  );
  let provisioned = 0;
  const dispatched: any[] = [];
  t.mock.method(apiRuntime.runnerProvisioner, 'start', async () => {
    provisioned++;
    return { status: 200, body: {} };
  });
  t.mock.method(
    apiRuntime.workflowExecution,
    'execute',
    async (params: any) => {
      dispatched.push(params);
      return { status: 202, body: {} };
    },
  );
  const app = express();
  app.use('/api/v1/workflows', machineExecutionsRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address() as { port: number };
  const run = (body: unknown, key = 'owner', idempotencyKey = 'focused') =>
    fetch(
      `http://127.0.0.1:${address.port}/api/v1/workflows/${workflow.id}/executions`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
        },
        body: JSON.stringify(body),
      },
    );
  assert.equal((await run({ regression: request }, 'missing')).status, 401);
  for (const key of ['other-owner', 'restricted', 'write-only'])
    assert.equal((await run({ regression: request }, key)).status, 404);
  for (const body of [
    { regression: { ...request, tests: [] } },
    { regression: request, nodes: [] },
    { regression: request, headSha: 'b'.repeat(40) },
    {
      regression: {
        ...request,
        sources: [{ ...request.sources[0], repository: 'other/private' }],
      },
    },
  ])
    assert.equal((await run(body)).status, 400);
  assert.equal(provisioned, 0);
  const first = await run({
    regression: request,
    inputs: { TARGET: 'staging' },
  });
  assert.equal(first.status, 202);
  const accepted = await first.json();
  assert.equal(dispatched.length, 1);
  assert.deepEqual(dispatched[0].body.regression, request);
  assert.equal(dispatched[0].body.ci, undefined);
  assert.deepEqual(dispatched[0].body.nodes, workflow.nodes);
  assert.equal(dispatched[0].resourceOwnerUserId, 'owner');
  const replay = await run({
    regression: request,
    inputs: { TARGET: 'staging' },
  });
  assert.equal(replay.status, 202);
  assert.equal((await replay.json()).executionId, accepted.executionId);
  assert.equal(dispatched.length, 1);
  assert.equal(
    (
      await run({
        regression: { ...request, mode: 'full' },
        inputs: { TARGET: 'staging' },
      })
    ).status,
    409,
  );
  const full = await run(
    { regression: { ...request, mode: 'full' } },
    'owner',
    'full',
  );
  assert.equal(full.status, 202);
  assert.notEqual((await full.json()).executionId, accepted.executionId);
  assert.equal(dispatched.length, 2);
  assert.equal(provisioned, 2);
});
