import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { once } from 'node:events';
import type { prisma as PrismaInstance } from '../lib/prisma';
import { apiTokens } from '../services/api-tokens';
import { createMachineManagementRouter } from './machine-management';

test('management HTTP routes enforce scope, ownership and safe deletion', async (t) => {
  const empty = async () => undefined;
  const prisma = {
    $transaction: empty,
    project: { findFirst: empty, findMany: empty, delete: empty },
    workflow: { count: empty, findFirst: empty, deleteMany: empty },
    workflowExecution: { count: empty },
    workflowSchedule: { findMany: empty },
  };
  const owner = 'management-test-owner';
  const projects = new Map([['p', { id: 'p', userId: owner, title: 'Test' }]]);
  const workflows = new Map([
    ['w', { id: 'w', userId: owner, projectId: 'p' }],
  ]);
  let active = false;
  let providerFailure = false;
  t.mock.method(apiTokens, 'authenticate', async (key: string) => ({
    id: key,
    userId: key === 'other-owner' ? 'other' : owner,
    scopes:
      key === 'execute-only'
        ? ['workflow:execute']
        : ['workflow:execute', 'workflow:write'],
    allowedWorkflowIds: key === 'restricted' ? ['w'] : [],
  }));
  t.mock.method(
    prisma,
    '$transaction',
    async (fn: (tx: typeof prisma) => unknown) => fn(prisma),
  );
  t.mock.method(
    prisma.project,
    'findFirst',
    async ({ where }: { where: { id: string; userId: string } }) => {
      const p = projects.get(where.id);
      return p?.userId === where.userId ? p : null;
    },
  );
  t.mock.method(
    prisma.project,
    'findMany',
    async ({ where }: { where: { userId: string } }) =>
      [...projects.values()]
        .filter((p) => p.userId === where.userId)
        .map((p) => ({ ...p, _count: { workflows: 1 } })),
  );
  t.mock.method(
    prisma.project,
    'delete',
    async ({ where }: { where: { id: string } }) => projects.delete(where.id),
  );
  t.mock.method(
    prisma.workflow,
    'count',
    async ({ where }: { where: { projectId: string } }) =>
      [...workflows.values()].filter((w) => w.projectId === where.projectId)
        .length,
  );
  t.mock.method(
    prisma.workflow,
    'findFirst',
    async ({ where }: { where: { id: string; userId: string } }) => {
      const w = workflows.get(where.id);
      return w?.userId === where.userId ? w : null;
    },
  );
  t.mock.method(
    prisma.workflow,
    'deleteMany',
    async ({ where }: { where: { id: string; userId: string } }) => ({
      count:
        workflows.get(where.id)?.userId === where.userId &&
        workflows.delete(where.id)
          ? 1
          : 0,
    }),
  );
  t.mock.method(prisma.workflowExecution, 'count', async () =>
    active ? 1 : 0,
  );
  t.mock.method(prisma.workflowSchedule, 'findMany', async () => {
    if (providerFailure) throw new Error('provider unavailable');
    return [];
  });
  const app = express();
  app.use(
    '/api/v1',
    createMachineManagementRouter(
      prisma as unknown as typeof PrismaInstance,
      async () => {
        if (providerFailure) throw new Error('Provider unavailable');
      },
    ),
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address() as { port: number };
  const request = (path: string, method = 'DELETE', key = 'management') =>
    fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, {
      method,
      headers: key ? { authorization: `Bearer ${key}` } : {},
    });
  assert.equal((await request('/workflows/w', 'DELETE', '')).status, 401);
  for (const key of ['execute-only', 'restricted']) {
    assert.equal((await request('/workflows/w', 'DELETE', key)).status, 403);
    assert.equal((await request('/projects/p', 'DELETE', key)).status, 403);
  }
  assert.equal(
    (await request('/projects/p', 'DELETE', 'other-owner')).status,
    404,
  );
  assert.equal(
    (await request('/workflows/w', 'DELETE', 'other-owner')).status,
    404,
  );
  assert.equal((await request('/projects?limit=0', 'GET')).status, 400);
  assert.deepEqual(
    (await (await request('/projects', 'GET', 'other-owner')).json()).projects,
    [],
  );
  assert.equal((await request('/projects/p')).status, 409);
  active = true;
  assert.equal((await request('/workflows/w')).status, 409);
  assert.ok(workflows.has('w'));
  active = false;
  providerFailure = true;
  assert.equal((await request('/workflows/w')).status, 500);
  assert.ok(workflows.has('w'));
  providerFailure = false;
  assert.equal((await request('/workflows/w')).status, 204);
  assert.equal((await request('/workflows/w')).status, 404);
  assert.equal((await request('/projects/p')).status, 204);
  assert.equal((await request('/projects/p')).status, 404);
});
