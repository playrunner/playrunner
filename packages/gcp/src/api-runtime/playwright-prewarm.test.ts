import assert from 'node:assert/strict';
import test from 'node:test';
import {
  prewarmGcpPlaywrightRunners,
  prewarmedAuthenticationProfileMarker,
} from './playwright-prewarm';

test('marks a prewarmed runner that must load an Authentication Profile', () => {
  assert.deepEqual(
    prewarmedAuthenticationProfileMarker(
      { authenticationProfileNodeIds: ['playwright-1'] },
      'playwright-1',
    ),
    { authenticationProfile: true },
  );
  assert.deepEqual(
    prewarmedAuthenticationProfileMarker(
      { authenticationProfileNodeIds: ['playwright-2'] },
      'playwright-1',
    ),
    {},
  );
});

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
