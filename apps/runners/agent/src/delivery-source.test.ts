import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBotDeliverySource } from './delivery-source';

test('uses the configured branch snapshot for a validated manual run', () => {
  assert.deepEqual(
    resolveBotDeliverySource(
      {
        headRevision: 'a'.repeat(40),
        repositoryRoot: '/workspace/repo',
        workingDirectory: '/workspace/repo',
      },
      { branch: 'main', repository: 'playrunner/demo-project' },
    ),
    {
      headRef: 'main',
      headSha: 'a'.repeat(40),
      repository: 'playrunner/demo-project',
    },
  );
});

test('preserves the trusted change context for CI delivery', () => {
  assert.deepEqual(
    resolveBotDeliverySource(
      {
        changeContext: {
          baseRef: 'main',
          baseSha: 'a'.repeat(40),
          eventType: 'push',
          headRef: 'feature/tests',
          headSha: 'b'.repeat(40),
          repository: 'playrunner/demo-project',
        },
        headRevision: 'b'.repeat(40),
        repositoryRoot: '/workspace/repo',
        workingDirectory: '/workspace/repo',
      },
      { branch: 'ignored', repository: 'playrunner/ignored' },
    ),
    {
      headRef: 'feature/tests',
      headSha: 'b'.repeat(40),
      repository: 'playrunner/demo-project',
    },
  );
});
