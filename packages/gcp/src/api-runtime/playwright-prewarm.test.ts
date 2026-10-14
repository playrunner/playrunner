import assert from 'node:assert/strict';
import test from 'node:test';
import { prewarmGcpPlaywrightRunners } from './playwright-prewarm';

test('local target prevents hosted prewarming without calling a provider', async () => {
  assert.deepEqual(
    await prewarmGcpPlaywrightRunners({
      body: {
        localWorker: { deviceId: 'device' },
        nodes: [{ nodeType: 'playwright' }],
      },
    } as unknown as Parameters<typeof prewarmGcpPlaywrightRunners>[0]),
    {},
  );
});
