import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterRunnerResources,
  parseDockerBytes,
  sampleRunnerResources,
} from './runner-resources';

const id = 'abcdef123456';
test('reads actual Docker usage, keeps CPU above one core, and scopes runner details', async () => {
  const snapshot = await sampleRunnerResources(async (args) => {
    if (args[0] === 'ps')
      return `${id}\tallowed\tnode-1\n123456abcdef\tother-user\tnode-2\n`;
    if (args[0] === 'info') return '10\t8589934592\n';
    if (args[0] === 'inspect')
      return `${id}\t4000000000\n123456abcdef\t2000000000\n`;
    return [
      { ID: id, CPUPerc: '250.50%', MemUsage: '1.25GiB / 4GiB' },
      { ID: '123456abcdef', CPUPerc: '100%', MemUsage: '500MiB / 2GiB' },
    ]
      .map((item) => JSON.stringify(item))
      .join('\n');
  });
  assert.equal(snapshot.available, true);
  const visible = filterRunnerResources(snapshot, new Set(['allowed']));
  assert.equal(visible.runners.length, 1);
  assert.equal(visible.runners[0].cpuPercent, 250.5);
  assert.equal(visible.runners[0].cpuLimit, 4);
  assert.equal(visible.runners[0].memoryBytes, 1.25 * 1024 ** 3);
  assert.equal(filterRunnerResources(snapshot, new Set()).runners.length, 0);
});
test('Docker unavailable is unknown rather than zero usage', async () => {
  const result = await sampleRunnerResources(async () => {
    throw new Error('unavailable');
  });
  assert.equal(result.available, false);
  assert.equal(result.capacity, null);
});
test('empty runner inventory still reports Docker capacity', async () => {
  const result = await sampleRunnerResources(async (args) =>
    args[0] === 'ps' ? '' : '8\t8000000000',
  );
  assert.equal(result.available, true);
  assert.deepEqual(result.runners, []);
  assert.equal(result.capacity?.cpus, 8);
});
test('invalid or disappearing container samples cannot claim zero usage', async () => {
  const result = await sampleRunnerResources(async (args) => {
    if (args[0] === 'ps') return `${id}\texecution\tnode`;
    if (args[0] === 'info') return '8\t8000000000';
    return '';
  });
  assert.equal(result.available, false);
  assert.equal(parseDockerBytes('1.5GB'), 1_500_000_000);
  assert.equal(parseDockerBytes('512MiB'), 512 * 1024 ** 2);
  assert.throws(() => parseDockerBytes('--'));
});
