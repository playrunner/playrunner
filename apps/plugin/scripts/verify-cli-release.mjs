import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = fileURLToPath(new URL('../../../packages/cli/', import.meta.url));
const registry = 'https://registry.npmjs.org';
const run = (name, args, cwd) => {
  const result = spawnSync(name, args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout;
};
const pkg = JSON.parse(await readFile(join(cli, 'package.json'), 'utf8'));
const plugin = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
assert.equal(
  plugin.config.playrunnerVersion,
  pkg.version,
  'Plugin CLI pin is stale',
);
const distTags = JSON.parse(
  run('npm', ['view', pkg.name, 'dist-tags', '--json', '--registry', registry]),
);
assert.equal(
  distTags.latest,
  pkg.version,
  'Local CLI version is not npm latest',
);
run('npm', ['run', 'build'], cli);

const temp = await mkdtemp(join(tmpdir(), 'playrunner-release-check-'));
try {
  const localDir = join(temp, 'local');
  const remoteDir = join(temp, 'registry');
  await mkdir(localDir);
  await mkdir(remoteDir);
  const [local] = JSON.parse(
    run('npm', ['pack', '--json', '--pack-destination', localDir], cli),
  );
  const [remote] = JSON.parse(
    run('npm', [
      'pack',
      `${pkg.name}@${pkg.version}`,
      '--json',
      '--registry',
      registry,
      '--pack-destination',
      remoteDir,
    ]),
  );
  assert.deepEqual(
    local.files.map((file) => file.path).sort(),
    remote.files.map((file) => file.path).sort(),
    'Published package file list differs from local build',
  );
  run('tar', ['-xzf', join(localDir, local.filename), '-C', localDir]);
  run('tar', ['-xzf', join(remoteDir, remote.filename), '-C', remoteDir]);
  const files = [];
  for (const { path } of local.files) {
    const source = await readFile(join(localDir, 'package', path));
    const published = await readFile(join(remoteDir, 'package', path));
    assert.ok(source.equals(published), `Published file differs: ${path}`);
    files.push({
      path,
      bytes: source.length,
      sha256: createHash('sha256').update(source).digest('hex'),
    });
  }
  const installDir = join(temp, 'install');
  await mkdir(installDir);
  run('npm', [
    'install',
    '--prefix',
    installDir,
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--registry',
    registry,
    `${pkg.name}@${pkg.version}`,
  ]);
  const installedRoot = join(installDir, 'node_modules/playrunner');
  assert.equal(
    run(process.execPath, [
      join(installedRoot, 'dist/cli.js'),
      '--version',
    ]).trim(),
    pkg.version,
  );
  run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "await import('playrunner'); await import('playrunner/authentication-capture'); console.log('exports resolved');",
    ],
    installDir,
  );
  const verification = {
    checkedAt: new Date().toISOString(),
    package: pkg.name,
    version: pkg.version,
    registry,
    distTags,
    sourceCommit: run('git', ['rev-parse', 'HEAD'], cli).trim(),
    publishedIntegrity: remote.integrity,
    identicalToFreshLocalBuild: true,
    installedVersionAndExportsVerified: true,
    files,
  };
  await writeFile(
    join(root, 'submission/cli-release-verification.json'),
    JSON.stringify(verification, null, 2) + '\n',
  );
  console.log(
    `Verified ${pkg.name}@${pkg.version} is npm latest, matches all ${files.length} local package files, and installs with both exports resolving.`,
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
