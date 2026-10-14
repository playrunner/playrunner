import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareLocalWorkspace } from './local-workspace';
import { fetchArtifactWithRetry } from './artifact-upload';
test('workspace copy preserves uncommitted tests without following host symlinks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-copy-'));
  try {
    const source = path.join(root, 'source');
    const target = path.join(root, 'target');
    fs.mkdirSync(path.join(source, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(source, 'tests/local.spec.ts'), 'uncommitted');
    fs.symlinkSync(os.homedir(), path.join(source, 'host-home'));
    fs.mkdirSync(path.join(source, 'node_modules'));
    assert.equal(
      prepareLocalWorkspace(source, target, '/tests'),
      path.join(target, 'tests'),
    );
    assert.equal(
      fs.readFileSync(path.join(target, 'tests/local.spec.ts'), 'utf8'),
      'uncommitted',
    );
    assert.ok(!fs.existsSync(path.join(target, 'host-home')));
    assert.ok(!fs.existsSync(path.join(target, 'node_modules')));
    assert.throws(() => prepareLocalWorkspace(source, target, '../outside'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('artifact upload retries transient failure using the same archive', async () => {
  const archive = new Uint8Array([1, 2, 3]);
  let calls = 0;
  const response = await fetchArtifactWithRetry(
    new URL('https://cloud.test/api/outputs/run/node'),
    { method: 'POST', body: archive },
    (async (_url, init) => {
      assert.equal(init?.body, archive);
      calls++;
      return new Response('{}', { status: calls === 1 ? 503 : 200 });
    }) as typeof fetch,
    async () => {},
  );
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});
test('artifact upload does not retry an invalid credential', async () => {
  let calls = 0;
  await fetchArtifactWithRetry(
    new URL('https://cloud.test'),
    {},
    (async () => {
      calls++;
      return new Response('{}', { status: 403 });
    }) as typeof fetch,
    async () => {},
  );
  assert.equal(calls, 1);
});
