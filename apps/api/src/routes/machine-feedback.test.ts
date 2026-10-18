import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import express from 'express';
import { createRequireApiToken } from '../auth/api-token.middleware';
import type { prisma as PrismaInstance } from '../lib/prisma';
import { registerMachineFeedbackRoutes } from './machine-feedback';

test('feedback HTTP route is read-only, owner-scoped, bounded and resumable', async (t) => {
  const time = new Date('2026-10-18T00:00:00Z');
  let reads = 0;
  const queries: any[] = [];
  const events = Array.from({ length: 102 }, (_, i) => ({
    id: BigInt(i + 1),
    executionId: 'run',
    type: 'node_state',
    nodeId: 'tests',
    payload: { state: 'running', secret: 'do-not-return' },
    createdAt: time,
    occurredAt: time,
  }));
  const database = {
    workflowExecution: {
      findFirst: async ({ where }: any) =>
        where.id === 'run' &&
        where.workflowId === 'workflow' &&
        where.userId === 'owner'
          ? {
              id: 'run',
              workflowId: 'workflow',
              cloudProvider: 'LOCAL_RUNNER',
              status: 'running',
              startedAt: time,
              completedAt: null,
            }
          : null,
    },
    workflowEvent: {
      findFirst: async (query: any) => {
        reads++;
        return query.where.type ? null : events.at(-1);
      },
      findMany: async (query: any) => {
        reads++;
        queries.push(query);
        const found = events.filter(
          (e) =>
            (!query.where.id?.gt || e.id > query.where.id.gt) &&
            e.id <= query.where.id.lte,
        );
        if (query.orderBy.id === 'desc') found.reverse();
        return found.slice(0, query.take);
      },
    },
  };
  const app = express();
  const router = express.Router();
  router.use(
    createRequireApiToken({
      authenticate: async (key) =>
        key === 'revoked'
          ? null
          : ({
              id: key,
              userId: key === 'other-owner' ? 'other' : 'owner',
              scopes: key === 'no-scope' ? [] : ['workflow:execute'],
              allowedWorkflowIds:
                key === 'restricted' ? ['different-workflow'] : [],
            } as any),
    }),
  );
  registerMachineFeedbackRoutes(
    router,
    database as unknown as typeof PrismaInstance,
  );
  app.use('/api/v1/workflows', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/workflows/workflow/executions/run/feedback`;
  const request = (key = 'owner', query = '', method = 'GET') =>
    fetch(base + query, {
      method,
      headers: key ? { Authorization: `Bearer ${key}` } : {},
    });
  assert.equal((await request('')).status, 401);
  assert.equal((await request('revoked')).status, 401);
  for (const key of ['other-owner', 'restricted', 'no-scope'])
    assert.equal((await request(key)).status, 404);
  assert.equal(reads, 0);
  assert.equal((await request('owner', '?after=-1')).status, 400);
  assert.equal((await request('owner', '?after=1&after=2')).status, 400);
  assert.equal(reads, 0);
  const firstResponse = await request();
  assert.equal(firstResponse.headers.get('cache-control'), 'private, no-store');
  const first = await firstResponse.json();
  assert.equal(first.status, 'running');
  assert.equal(first.changes.length, 100);
  assert.equal(first.nextCursor, '100');
  assert.equal(first.hasMore, true);
  assert.doesNotMatch(JSON.stringify(first), /do-not-return/);
  const second = await (await request('owner', '?after=100')).json();
  assert.deepEqual(
    second.changes.map((e: any) => e.sequence),
    ['101', '102'],
  );
  assert.equal(second.hasMore, false);
  assert.ok(
    queries.every(
      (query) => query.take <= 1001 && query.where.executionId === 'run',
    ),
  );
  assert.equal((await request('owner', '', 'POST')).status, 404);
});
