import { realpathSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  connectionHelp,
  parseConnectionArgs,
  mcpAddArgs,
  existingConnection,
} from './connection.mjs';
import { packagePlugin, pluginRoot } from './package.mjs';

import { runCodex } from './connect.mjs';

async function isGeneratedMarketplace(marketplace, sourceRoot, name) {
  const source = marketplace.marketplaceSource;
  if (source?.sourceType !== 'local' || typeof source.source !== 'string')
    return false;
  const root = resolve(source.source);
  const version = new RegExp(`^${name}-plugin-(\\d+\\.\\d+\\.\\d+)$`).exec(
    basename(root),
  )?.[1];
  if (
    !version ||
    marketplace.root !== root ||
    dirname(root) !== resolve(sourceRoot, 'dist')
  )
    return false;
  try {
    // A matching filename elsewhere, or a symlink out of this checkout's dist,
    // does not establish that the installer owns the configured marketplace.
    if (
      dirname(await realpath(root)) !==
      (await realpath(join(sourceRoot, 'dist')))
    )
      return false;
    const catalog = JSON.parse(
      await readFile(join(root, '.agents/plugins/marketplace.json'), 'utf8'),
    );
    const manifest = JSON.parse(
      await readFile(join(root, 'plugins', name, 'plugin.json'), 'utf8'),
    );
    return (
      catalog.name === name &&
      catalog.plugins?.length === 1 &&
      catalog.plugins[0].name === name &&
      catalog.plugins[0].source?.source === 'local' &&
      catalog.plugins[0].source?.path === `./plugins/${name}` &&
      manifest.name === name &&
      manifest.version === version
    );
  } catch {
    return false;
  }
}

export async function installPlugin({
  sourceRoot = pluginRoot,
  build = packagePlugin,
  run = runCodex,
  connection = null,
} = {}) {
  const name = connection?.name || 'playrunner';
  const alreadyConnected = connection
    ? existingConnection(JSON.parse(run(['mcp', 'list', '--json'])), connection)
    : false;
  const listing = JSON.parse(run(['plugin', 'marketplace', 'list', '--json']));
  if (!Array.isArray(listing.marketplaces))
    throw new Error('Codex did not return a valid marketplace list.');
  const matches = listing.marketplaces.filter((entry) => entry.name === name);
  if (matches.length > 1)
    throw new Error(
      'Multiple Playrunner marketplaces were returned; no source was changed.',
    );
  const current = matches[0];
  if (current && !(await isGeneratedMarketplace(current, sourceRoot, name))) {
    throw new Error(
      'The playrunner marketplace is not a generated release from this checkout. Its source was left unchanged.',
    );
  }
  const { marketplaceRoot } = await build(undefined, { connection });
  if (current && current.root !== marketplaceRoot) {
    // Remove only the configured source, never the installed plugin or its
    // connection. Codex rejects adding the same marketplace name at a new path.
    run(['plugin', 'marketplace', 'remove', name]);
    try {
      run(['plugin', 'marketplace', 'add', marketplaceRoot]);
    } catch (error) {
      try {
        run(['plugin', 'marketplace', 'add', current.root]);
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          'Marketplace replacement failed and the previous source could not be restored.',
        );
      }
      throw new Error(
        'Marketplace replacement failed; the previous source was restored.',
        {
          cause: error,
        },
      );
    }
  } else if (!current) {
    run(['plugin', 'marketplace', 'add', marketplaceRoot]);
  }
  if (connection && !alreadyConnected) run(mcpAddArgs(connection));
  try {
    run(['plugin', 'add', `${name}@${name}`]);
  } catch (error) {
    if (connection && !alreadyConnected) run(['mcp', 'remove', name]);
    throw error;
  }
  return { marketplaceRoot, name, connection };
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
  const result = await installPlugin(options);
  console.log(
    `${result.name} installed. Start a new Codex task and select its Playrunner skill.`,
  );
}
