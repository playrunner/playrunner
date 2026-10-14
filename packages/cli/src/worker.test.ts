import assert from 'node:assert/strict';
import test from 'node:test';
import { localWorkerDockerArgs } from './worker.js';
const job = { id: 'a'.repeat(64), cpu: 2, memory: 4, source: 'workspace' };
test('worker mounts only an explicit read-only checkout and applies resource limits', () => {
  const args = localWorkerDockerArgs(
    job,
    '/projects/test app',
    'container',
    'local-image',
  );
  assert.ok(
    args.includes(
      'type=bind,source=/projects/test app,target=/playrunner-workspace,readonly',
    ),
  );
  assert.equal(args[args.indexOf('--cpus') + 1], '2');
  assert.equal(args[args.indexOf('--memory') + 1], '4g');
  assert.ok(args.includes('no-new-privileges'));
  assert.ok(!args.includes('--privileged'));
  assert.equal(args.at(-1), 'local-image');
});
test('worker rejects missing workspace, mount argument injection and excess resources', () => {
  for (const workspace of [undefined, '/tmp/test,target=/etc', '/tmp/a\nb'])
    assert.throws(() =>
      localWorkerDockerArgs(job, workspace, 'container', 'image'),
    );
  assert.throws(() =>
    localWorkerDockerArgs(
      { ...job, cpu: 100 },
      '/tmp/app',
      'container',
      'image',
    ),
  );
});
test('workflow source does not mount the checkout', () => {
  assert.ok(
    !localWorkerDockerArgs(
      { ...job, source: 'workflow' },
      '/tmp/app',
      'container',
      'image',
    ).includes('--mount'),
  );
});
