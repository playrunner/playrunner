import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import { createReadinessProbe, readinessHandler } from './readiness';

test('health returns 503 for unreachable dependencies, with bounded safe diagnostics', async (t) => {
  const dependency = createServer((_req, res) => res.end('{}')).listen(
    0,
    '127.0.0.1',
  );
  await once(dependency, 'listening');
  const port = (dependency.address() as { port: number }).port;
  const probe = createReadinessProbe({
    database: async () => {
      throw new Error('postgres://private:secret@internal');
    },
    emulatorHost: `127.0.0.1:${port}`,
    projectId: 'test',
  });
  const app = express();
  app.get('/health', readinessHandler(probe, true));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.close();
    dependency.close();
  });
  const response = await fetch(
    `http://127.0.0.1:${(server.address() as { port: number }).port}/health`,
  );
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.checks[0].service, 'database');
  assert.equal(body.checks[0].status, 'unavailable');
  assert.equal(body.checks[1].status, 'ready');
  assert.doesNotMatch(JSON.stringify(body), /private|secret|internal/);
  dependency.close();
  await once(dependency, 'close');
  const outage = await createReadinessProbe({
    database: async () => 1,
    emulatorHost: `127.0.0.1:${port}`,
    mcpHealthUrl: `http://127.0.0.1:${port}/health`,
    projectId: 'test',
  })();
  assert.equal(outage.status, 'unavailable');
  assert.ok(
    ['connection_refused', 'connection_lost'].includes(
      outage.checks[1].reason!,
    ),
  );
  assert.equal(outage.checks[2].reason, 'connection_refused');
  assert.deepEqual(
    outage.checks.map((check) => check.status),
    ['ready', 'unavailable', 'unavailable'],
  );
});

test('slow dependencies time out and concurrent probes share a check', async (t) => {
  let checks = 0;
  const probe = createReadinessProbe({
    database: () => {
      checks++;
      return new Promise(() => {});
    },
    projectId: 'test',
  });
  const started = Date.now();
  const [first, second] = await Promise.all([probe(), probe()]);
  assert.equal(first.status, 'unavailable');
  assert.equal(checks, 1);
  assert.deepEqual(first, second);
  assert.ok(Date.now() - started < 4000);
  assert.equal(first.checks[0].reason, 'timeout');
  t.mock.method(Date, 'now', () => started + 6000);
  await probe();
  assert.equal(
    checks,
    1,
    'Do not accumulate queries while the driver is still waiting',
  );
});

test('healthy compatibility endpoint keeps OK and readiness lists checked services', async (t) => {
  const probe = createReadinessProbe({
    database: async () => 1,
    projectId: 'test',
  });
  const app = express();
  app.get('/health', readinessHandler(probe, true));
  app.get('/ready', readinessHandler(probe));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const health = await fetch(`${origin}/health`);
  assert.equal(health.status, 200);
  assert.equal(await health.text(), 'OK');
  const ready = await fetch(`${origin}/ready`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), {
    status: 'ready',
    checks: [{ service: 'database', status: 'ready' }],
  });
});
