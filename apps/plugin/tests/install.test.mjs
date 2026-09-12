import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { installPlugin } from '../scripts/install.mjs';

async function fixture(t) {
  const sourceRoot = await mkdtemp(join(tmpdir(), 'playrunner-install-'));
  t.after(() => rm(sourceRoot, { recursive: true, force: true }));
  const previousRoot = join(sourceRoot, 'dist/playrunner-plugin-0.1.0');
  const marketplaceRoot = join(sourceRoot, 'dist/playrunner-plugin-0.1.1');
  const catalog = {
    name: 'playrunner',
    plugins: [
      {
        name: 'playrunner',
        source: { source: 'local', path: './plugins/playrunner' },
      },
    ],
  };
  for (const [root, version] of [
    [previousRoot, '0.1.0'],
    [marketplaceRoot, '0.1.1'],
  ]) {
    await mkdir(join(root, '.agents/plugins'), { recursive: true });
    await mkdir(join(root, 'plugins/playrunner'), { recursive: true });
    await writeFile(
      join(root, '.agents/plugins/marketplace.json'),
      JSON.stringify(catalog),
    );
    await writeFile(
      join(root, 'plugins/playrunner/plugin.json'),
      JSON.stringify({ name: 'playrunner', version }),
    );
  }
  const entry = {
    name: 'playrunner',
    root: previousRoot,
    marketplaceSource: { sourceType: 'local', source: previousRoot },
  };
  const calls = [];
  const run = (args) => {
    calls.push(args);
    return JSON.stringify({ marketplaces: [entry] });
  };
  return { sourceRoot, previousRoot, marketplaceRoot, entry, calls, run };
}

test('upgrades a recognized generated marketplace without uninstalling the connected plugin', async (t) => {
  const f = await fixture(t);
  await installPlugin({ ...f, build: async () => f });
  assert.deepEqual(f.calls, [
    ['plugin', 'marketplace', 'list', '--json'],
    ['plugin', 'marketplace', 'remove', 'playrunner'],
    ['plugin', 'marketplace', 'add', f.marketplaceRoot],
    ['plugin', 'add', 'playrunner@playrunner'],
  ]);
});

test('does not replace an arbitrary marketplace sharing the Playrunner name', async (t) => {
  const f = await fixture(t);
  f.entry.root = join(f.sourceRoot, 'user-marketplace');
  f.entry.marketplaceSource.source = f.entry.root;
  await assert.rejects(
    installPlugin({ ...f, build: async () => f }),
    /not a generated release/,
  );
  assert.deepEqual(f.calls, [['plugin', 'marketplace', 'list', '--json']]);
});

test('reinstalling the current version leaves its marketplace registered', async (t) => {
  const f = await fixture(t);
  f.entry.root = f.marketplaceRoot;
  f.entry.marketplaceSource.source = f.marketplaceRoot;
  await installPlugin({ ...f, build: async () => f });
  assert.deepEqual(f.calls, [
    ['plugin', 'marketplace', 'list', '--json'],
    ['plugin', 'add', 'playrunner@playrunner'],
  ]);
});

test('restores the previous source if replacement registration fails', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    installPlugin({
      ...f,
      build: async () => f,
      run: (args) => {
        const result = f.run(args);
        if (args[2] === 'add' && args[3] === f.marketplaceRoot)
          throw new Error('Mock registration failure');
        return result;
      },
    }),
    /previous source was restored/,
  );
  assert.deepEqual(f.calls, [
    ['plugin', 'marketplace', 'list', '--json'],
    ['plugin', 'marketplace', 'remove', 'playrunner'],
    ['plugin', 'marketplace', 'add', f.marketplaceRoot],
    ['plugin', 'marketplace', 'add', f.previousRoot],
  ]);
});
