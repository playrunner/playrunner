import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  encodeRelativeOutputPath,
  findSafeOutputMedia,
  isSafeOutputPathSegment,
  resolveOutputDirectory,
} from './output-paths';

test('accepts normal execution and node identifiers', () => {
  assert.equal(isSafeOutputPathSegment('exec_123-abc'), true);
  assert.equal(isSafeOutputPathSegment('node.4'), true);
  assert.equal(
    resolveOutputDirectory('/tmp/playrunner-outputs', 'exec_123', 'node.4'),
    path.resolve('/tmp/playrunner-outputs/exec_123/node.4'),
  );
});

test('encodes every output URL path segment', () => {
  const root = path.resolve('/tmp/playrunner-outputs/exec/node');
  assert.equal(
    encodeRelativeOutputPath(
      root,
      path.join(root, 'test-results', 'checkout #1?.png'),
    ),
    'test-results/checkout%20%231%3F.png',
  );
  assert.throws(
    () => encodeRelativeOutputPath(root, path.resolve(root, '../outside')),
    /escapes/,
  );
});

test('finds media without following symbolic links', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'playrunner-media-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'playrunner-outside-'));
  t.after(() => {
    fs.rmSync(root, { force: true, recursive: true });
    fs.rmSync(outside, { force: true, recursive: true });
  });
  fs.mkdirSync(path.join(root, 'test-results', 'nested'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'test-results', 'nested', 'shot.png'),
    'png',
  );
  fs.writeFileSync(path.join(root, 'test-results', 'run.webm'), 'webm');
  fs.writeFileSync(path.join(root, 'test-results', 'ignored.txt'), 'text');
  fs.writeFileSync(path.join(outside, 'outside.png'), 'outside');
  fs.symlinkSync(outside, path.join(root, 'test-results', 'linked-directory'));
  fs.symlinkSync(
    path.join(outside, 'outside.png'),
    path.join(root, 'test-results', 'linked.png'),
  );

  assert.deepEqual(
    findSafeOutputMedia(root).map((file) => path.relative(root, file)),
    [
      path.join('test-results', 'nested', 'shot.png'),
      path.join('test-results', 'run.webm'),
    ],
  );
});

test('bounds media traversal by entry count and depth', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'playrunner-media-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  fs.mkdirSync(path.join(root, 'test-results', 'one', 'two'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(root, 'test-results', 'one', 'two', 'shot.png'),
    'x',
  );

  assert.deepEqual(findSafeOutputMedia(root, { maxDepth: 1 }), []);
  assert.deepEqual(findSafeOutputMedia(root, { maxEntries: 1 }), []);
});

test('rejects path traversal and unsafe path segments', () => {
  for (const value of [
    '',
    '.',
    '..',
    '../outside',
    'nested/node',
    '..\\outside',
    '/absolute',
    'node with spaces',
    'node%20encoded',
    'node@host',
    '\u001fcontrol',
    'node\0suffix',
    'x'.repeat(256),
  ]) {
    assert.equal(isSafeOutputPathSegment(value), false, value);
  }

  assert.throws(
    () =>
      resolveOutputDirectory('/tmp/playrunner-outputs', '../outside', 'node-1'),
    /Invalid output path/,
  );
});
