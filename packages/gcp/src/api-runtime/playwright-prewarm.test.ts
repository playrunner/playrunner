import assert from 'node:assert/strict';
import test from 'node:test';
import { prewarmedAuthenticationProfileMarker } from './playwright-prewarm';

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
