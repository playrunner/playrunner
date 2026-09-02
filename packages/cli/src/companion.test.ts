import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const packageDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

test('companion polling keeps the CLI process alive until the delay settles', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      `
        import { waitForCompanionPoll } from './src/companion.ts';
        await waitForCompanionPoll(20, new AbortController().signal);
        process.stdout.write('completed');
      `,
    ],
    { cwd: packageDirectory, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'completed');
  assert.doesNotMatch(result.stderr, /unsettled top-level await/i);
});
