import { realpathSync } from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { connectionHelp, parseConnectionArgs } from './connection.mjs';

export const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
export const releaseFiles = [
  'plugin.json',
  '.codex-plugin/plugin.json',
  '.mcp.json',
  'mcp.json',
  'package.json',
  'LICENSE',
  'README.md',
  'assets/logo.png',
  'skills/playrunner/SKILL.md',
  'skills/playrunner/runtime.json',
  'skills/playrunner/connection.json',
  'skills/playrunner/scripts/playrunner.mjs',
  'scripts/playrunner.mjs',
  'scripts/connection.mjs',
  'scripts/connect.mjs',
];

export function command(name, args, options = {}) {
  const result = spawnSync(name, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${name} failed (${result.status ?? result.signal}).`);
  }
}

export async function packagePlugin(
  output = join(pluginRoot, 'dist'),
  { connection = null } = {},
) {
  const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
  const manifest = await readJson(join(pluginRoot, 'plugin.json'));
  const compatibility = await readJson(
    join(pluginRoot, '.codex-plugin/plugin.json'),
  );
  const pkg = await readJson(join(pluginRoot, 'package.json'));
  const runtime = await readJson(
    join(pluginRoot, 'skills/playrunner/runtime.json'),
  );
  assert.equal(
    runtime.config.playrunnerVersion,
    pkg.config.playrunnerVersion,
    'Skill CLI pin is stale',
  );
  assert.equal(manifest.name, 'playrunner');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.match(pkg.config.playrunnerVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(
    manifest.version,
    pkg.version,
    'Package and plugin versions differ',
  );
  assert.equal(
    manifest.version,
    compatibility.version,
    'Manifest versions differ',
  );
  assert.equal(manifest.name, compatibility.name, 'Manifest names differ');
  for (const [field, limit] of [
    ['displayName', 30],
    ['shortDescription', 30],
    ['longDescription', 4000],
    ['developerName', 80],
  ]) {
    const value = compatibility.interface[field];
    assert.ok(
      typeof value === 'string' && value.trim(),
      `${field} is required`,
    );
    assert.ok(
      value.length <= limit,
      `${field} exceeds the public directory limit`,
    );
  }
  assert.equal(
    compatibility.author.name,
    compatibility.interface.developerName,
  );
  assert.ok(compatibility.interface.defaultPrompt.length <= 3);
  for (const prompt of compatibility.interface.defaultPrompt) {
    assert.ok(prompt.length <= 128 && !/[\r\n]/.test(prompt));
  }

  const name = connection?.name || 'playrunner';
  const folderName = `${name}-plugin-${manifest.version}`;
  const marketplaceRoot = join(resolve(output), folderName);
  const destination = join(marketplaceRoot, 'plugins', name);
  // Only replace this generated release directory, never the source plugin.
  await rm(marketplaceRoot, { recursive: true, force: true });
  for (const file of releaseFiles) {
    const target = join(destination, file);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(pluginRoot, file), target);
  }
  if (connection) {
    // Named connections are registered by Codex's supported MCP CLI. Keep the
    // plugin skill-only so a self-hosted install never connects to Cloud too.
    // No token is read here or written into a generated artifact.
    const portable = { ...manifest, name };
    const legacy = {
      ...compatibility,
      name,
      interface: {
        ...compatibility.interface,
        displayName: `Playrunner: ${name.slice('playrunner-'.length)}`.slice(
          0,
          30,
        ),
        longDescription:
          'Manage workflows on the configured Playrunner server.',
      },
    };
    delete legacy.mcpServers;
    await writeFile(
      join(destination, 'plugin.json'),
      JSON.stringify(portable, null, 2) + '\n',
    );
    await writeFile(
      join(destination, '.codex-plugin/plugin.json'),
      JSON.stringify(legacy, null, 2) + '\n',
    );
    await rm(join(destination, '.mcp.json'));
    await rm(join(destination, 'mcp.json'));
    await writeFile(
      join(destination, 'skills/playrunner/connection.json'),
      JSON.stringify(connection, null, 2) + '\n',
    );
    const skillPath = join(destination, 'skills/playrunner/SKILL.md');
    const skill = await readFile(skillPath, 'utf8');
    await writeFile(
      skillPath,
      skill.replace('name: playrunner\n', `name: ${name}\n`),
    );
  }
  const catalogPath = join(marketplaceRoot, '.agents/plugins/marketplace.json');
  await mkdir(dirname(catalogPath), { recursive: true });
  await writeFile(
    catalogPath,
    JSON.stringify(
      {
        name,
        interface: { displayName: connection ? name : 'Playrunner' },
        plugins: [
          {
            name,
            source: { source: 'local', path: `./plugins/${name}` },
            policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
            category: 'Developer Tools',
          },
        ],
      },
      null,
      2,
    ) + '\n',
  );
  const archive = join(resolve(output), `${folderName}.tar.gz`);
  command('tar', ['-czf', archive, '-C', resolve(output), folderName]);
  if (connection)
    return { archive, marketplaceRoot, destination, name, connection };
  // The portal accepts one plugin at the ZIP root, without a marketplace wrapper.
  const submissionZip = join(
    resolve(output),
    `playrunner-${manifest.version}-submission.zip`,
  );
  await rm(submissionZip, { force: true });
  // Public remote-MCP submissions register their endpoint in the portal. Upload
  // only the portable skill bundle, without a local MCP server declaration.
  const submissionFiles = releaseFiles.filter(
    (file) =>
      !['mcp.json', '.mcp.json', '.codex-plugin/plugin.json'].includes(file),
  );
  command('zip', ['-q', '-X', submissionZip, ...submissionFiles], {
    cwd: destination,
  });
  const skillZip = join(
    resolve(output),
    `playrunner-skill-${manifest.version}.zip`,
  );
  await rm(skillZip, { force: true });
  command(
    'zip',
    [
      '-q',
      '-X',
      skillZip,
      'SKILL.md',
      'runtime.json',
      'connection.json',
      'scripts/playrunner.mjs',
    ],
    { cwd: join(destination, 'skills/playrunner') },
  );
  return {
    archive,
    submissionZip,
    skillZip,
    marketplaceRoot,
    destination,
    name,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  const options = parseConnectionArgs(process.argv.slice(2));
  if (options.help) {
    console.log(connectionHelp);
    process.exit(0);
  }
  const result = await packagePlugin(undefined, options);
  console.log(`Packaged: ${result.archive}`);
  if (result.skillZip)
    console.log(`Remote MCP skill upload: ${result.skillZip}`);
  if (result.submissionZip)
    console.log(`Portable plugin submission: ${result.submissionZip}`);
  console.log(`Marketplace: ${result.marketplaceRoot}`);
}
