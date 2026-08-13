import assert from 'node:assert/strict';
import test from 'node:test';

import { describePlaywrightProcessExit } from './process-exit';

test('preserves ordinary Playwright test failure exit codes', () => {
  assert.equal(
    describePlaywrightProcessExit({ code: 1, sharded: false, signal: null }),
    'Tests failed with code 1',
  );
});

test('explains a missing exit code and recommends Auto sharding', () => {
  const message = describePlaywrightProcessExit({
    code: null,
    sharded: false,
    signal: 'SIGKILL',
  });

  assert.match(message, /likely crashed or was terminated/);
  assert.match(message, /CPU or memory/);
  assert.match(message, /enabling Suite sharding Auto/);
  assert.match(message, /SIGKILL/);
});

test('recommends larger per-shard limits when Auto is already active', () => {
  const message = describePlaywrightProcessExit({
    code: null,
    sharded: true,
    signal: null,
  });

  assert.match(message, /Auto sharding is already enabled/);
  assert.match(message, /maximum CPU or memory per shard/);
});
