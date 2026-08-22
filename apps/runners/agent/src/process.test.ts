import assert from 'node:assert/strict';
import test from 'node:test';
import { runProcess } from './process';

test('writes bounded stdin and captures child output', async () => {
  const result = await runProcess(
    process.execPath,
    [
      '-e',
      "process.stdin.setEncoding('utf8'); let value=''; process.stdin.on('data', chunk => value += chunk); process.stdin.on('end', () => process.stdout.write(value.toUpperCase()));",
    ],
    { input: 'feedback' },
  );
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'FEEDBACK');
  assert.equal(result.timedOut, false);
});

test('handles EPIPE when a child exits before consuming a large input', async () => {
  const result = await runProcess(process.execPath, ['-e', 'process.exit(7)'], {
    input: 'x'.repeat(10 * 1024 * 1024),
    timeoutMs: 2_000,
  });
  assert.equal(result.code, 7);
  assert.equal(result.timedOut, false);
});

test('retains only the bounded tail of process output', async () => {
  const result = await runProcess(
    process.execPath,
    ['-e', "process.stdout.write('a'.repeat(2048) + 'tail')"],
    { maxOutputBytes: 1024 },
  );
  assert.equal(result.stdout.length, 1024);
  assert.equal(result.stdoutTruncated, true);
  assert.match(result.stdout, /tail$/);
});

test('applies output bounds in UTF-8 bytes rather than characters', async () => {
  const result = await runProcess(
    process.execPath,
    ['-e', "process.stdout.write('é'.repeat(4000))"],
    { maxOutputBytes: 1_024 },
  );

  assert.equal(result.code, 0);
  assert.equal(result.stdoutTruncated, true);
  assert.ok(Buffer.byteLength(result.stdout, 'utf8') <= 1_024);
  assert.doesNotMatch(result.stdout, /�/);
});

test('terminates a process that exceeds its timeout', async () => {
  const result = await runProcess(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    { timeoutMs: 50 },
  );
  assert.equal(result.timedOut, true);
  assert.equal(result.signal, 'SIGTERM');
  assert.ok(result.durationMs < 2_000);
});

test('terminates the full shell process group on timeout', async () => {
  const result = await runProcess('/bin/sh', ['-lc', 'sleep 2 & wait'], {
    timeoutMs: 50,
  });
  assert.equal(result.timedOut, true);
  assert.ok(result.durationMs < 1_000);
});
