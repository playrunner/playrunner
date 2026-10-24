import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import type { prisma as PrismaInstance } from '../lib/prisma';

test('machine HTTP start failures retain the service outage diagnosis and execution ID', async (t) => {
  const workflow = {
    id: 'workflow',
    userId: 'owner',
    cloudProvider: 'LOCAL_RUNNER',
    nodes: [],
    connections: [],
    concurrency: null,
    title: 'Service check',
  };
  const previous = globalThis.prisma;
  globalThis.prisma = {
    workflow: {
      findFirst: async () => workflow,
      findUnique: async () => workflow,
    },
  } as unknown as typeof PrismaInstance;
  t.after(() => {
    globalThis.prisma = previous;
  });
  const { apiTokens } = await import('../services/api-tokens');
  const { serviceFailureBody } = await import('../runtime/service-diagnostics');
  t.mock.method(apiTokens, 'authenticate', async () => ({
    id: 'test-key',
    userId: 'owner',
    scopes: ['workflow:execute'],
    allowedWorkflowIds: [],
  }));
  const { apiRuntime } = await import('../runtime');
  const { machineExecutionsRouter } = await import('./machine-executions');
  t.mock.method(apiRuntime.runnerProvisioner, 'start', async () => ({
    status: 200,
    body: {},
  }));
  t.mock.method(apiRuntime.workflowExecution, 'execute', async () => ({
    status: 503,
    body: serviceFailureBody(
      'LOCAL_EVENT_SERVICE_UNAVAILABLE',
      'connection_refused',
    ),
  }));
  const app = express();
  app.use('/api/v1/workflows', machineExecutionsRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const response = await fetch(
    `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/workflows/workflow/executions`,
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-key',
        'content-type': 'application/json',
      },
      body: '{}',
    },
  );
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.code, 'LOCAL_EVENT_SERVICE_UNAVAILABLE');
  assert.equal(body.reason, 'connection_refused');
  assert.equal(body.status, 'failed_to_start');
  assert.ok(body.executionId);
  assert.match(body.error, /workflow has not started/);
  assert.match(body.error, /refused the connection/);
});
