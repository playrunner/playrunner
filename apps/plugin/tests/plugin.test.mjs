import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { packagePlugin, pluginRoot } from '../scripts/package.mjs';

async function workspace(t) {
  const path = await mkdtemp(join(tmpdir(), 'playrunner-plugin-test-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('archive installs independently of the checkout and excludes development files', async (t) => {
  const temp = await workspace(t);
  const { archive } = await packagePlugin(join(temp, 'output'));
  const extracted = join(temp, 'extracted');
  await mkdir(extracted);
  const tar = spawnSync('tar', ['-xzf', archive, '-C', extracted]);
  assert.equal(tar.status, 0, tar.stderr.toString());
  const root = join(extracted, 'playrunner-plugin-0.1.1');
  const catalog = JSON.parse(
    await readFile(join(root, '.agents/plugins/marketplace.json'), 'utf8'),
  );
  const installed = join(root, catalog.plugins[0].source.path);
  const list = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' });
  assert.equal(list.status, 0);
  assert.doesNotMatch(
    list.stdout,
    /node_modules|\.env|tests\/|package-lock|scripts\/install/,
  );
  const manifest = JSON.parse(
    await readFile(join(installed, 'plugin.json'), 'utf8'),
  );
  assert.equal(manifest.name, catalog.plugins[0].name);
  const legacy = JSON.parse(
    await readFile(join(installed, '.codex-plugin/plugin.json'), 'utf8'),
  );
  await readFile(join(installed, legacy.interface.logo));
  await readFile(join(installed, legacy.skills, 'playrunner/SKILL.md'));

  // The extracted launcher must resolve its own pin, preserve arguments without
  // a shell, and run from the user's project rather than the plugin directory.
  const bin = join(temp, 'bin');
  await mkdir(bin);
  await writeFile(
    join(bin, 'npx'),
    `#!${process.execPath}\nconsole.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), hasToken: Boolean(process.env.PLAYRUNNER_API_KEY) }));\nprocess.exit(Number(process.env.TEST_CLI_EXIT ?? 0));\n`,
    { mode: 0o755 },
  );
  const args = [
    'workflow-id',
    '--input',
    'value=spaces; $(untouched)',
    '--json',
  ];
  for (const code of [0, 1, 2, 124, 130]) {
    const run = spawnSync(
      process.execPath,
      [join(installed, 'scripts/playrunner.mjs'), ...args],
      {
        cwd: temp,
        env: {
          ...process.env,
          PATH: bin,
          PLAYRUNNER_API_KEY: 'test-only-token',
          TEST_CLI_EXIT: String(code),
        },
        encoding: 'utf8',
      },
    );
    assert.equal(run.status, code, run.stderr);
    const result = JSON.parse(run.stdout);
    assert.deepEqual(result.args, [
      '--yes',
      '--package=playrunner@0.2.5',
      '--',
      'playrunner',
      ...args,
    ]);
    assert.equal(result.cwd, await realpath(temp));
    assert.equal(result.hasToken, true);
    assert.doesNotMatch(run.stdout + run.stderr, /test-only-token/);
  }
});

test('missing npm produces an actionable error and a nonzero exit', async (t) => {
  const empty = await workspace(t);
  const run = spawnSync(
    process.execPath,
    [join(pluginRoot, 'scripts/playrunner.mjs'), '--help'],
    {
      env: { ...process.env, PATH: empty },
      encoding: 'utf8',
    },
  );
  assert.equal(run.status, 2);
  assert.match(run.stderr, /Check Node.js and npm/);
});
