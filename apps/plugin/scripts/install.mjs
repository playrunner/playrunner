import { spawnSync } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packagePlugin, pluginRoot } from './package.mjs';

function runCodex(args) {
  const result = spawnSync('codex', args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() ||
        `codex failed (${result.status ?? result.signal}).`,
    );
  }
  return result.stdout;
}

async function isGeneratedMarketplace(marketplace, sourceRoot) {
  const source = marketplace.marketplaceSource;
  if (source?.sourceType !== 'local' || typeof source.source !== 'string')
    return false;
  const root = resolve(source.source);
  const version = /^playrunner-plugin-(\d+\.\d+\.\d+)$/.exec(
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
      await readFile(join(root, 'plugins/playrunner/plugin.json'), 'utf8'),
    );
    return (
      catalog.name === 'playrunner' &&
      catalog.plugins?.length === 1 &&
      catalog.plugins[0].name === 'playrunner' &&
      catalog.plugins[0].source?.source === 'local' &&
      catalog.plugins[0].source?.path === './plugins/playrunner' &&
      manifest.name === 'playrunner' &&
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
} = {}) {
  const { marketplaceRoot } = await build();
  const listing = JSON.parse(run(['plugin', 'marketplace', 'list', '--json']));
  if (!Array.isArray(listing.marketplaces))
    throw new Error('Codex did not return a valid marketplace list.');
  const matches = listing.marketplaces.filter(
    (entry) => entry.name === 'playrunner',
  );
  if (matches.length > 1)
    throw new Error(
      'Multiple Playrunner marketplaces were returned; no source was changed.',
    );
  const current = matches[0];
  if (current && !(await isGeneratedMarketplace(current, sourceRoot))) {
    throw new Error(
      'The playrunner marketplace is not a generated release from this checkout. Its source was left unchanged.',
    );
  }
  if (current && current.root !== marketplaceRoot) {
    // Remove only the configured source, never the installed plugin or its
    // connection. Codex rejects adding the same marketplace name at a new path.
    run(['plugin', 'marketplace', 'remove', 'playrunner']);
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
  run(['plugin', 'add', 'playrunner@playrunner']);
  return { marketplaceRoot };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await installPlugin();
  console.log(
    'Playrunner installed. Start a new Codex task and select the Playrunner skill.',
  );
}
