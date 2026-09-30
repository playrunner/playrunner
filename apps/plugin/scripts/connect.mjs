import { realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { connectionHelp, parseConnectionArgs } from './connection.mjs';
import { configureServer } from './server-registry.mjs';

export function runCodex(args) {
  const result = spawnSync('codex', args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      result.stderr.trim() ||
        `codex failed (${result.status ?? result.signal}).`,
    );
  return result.stdout;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  try {
    const options = parseConnectionArgs(process.argv.slice(2));
    if (options.help) console.log(connectionHelp);
    else {
      const result = await configureServer(options.connection);
      console.log(`Configured ${result.profile.id} at ${result.profile.url}.`);
      console.log(`Private credential file: ${result.credentialFile}`);
      console.log(
        'The user supplies JSON containing url (the exact endpoint) and token, with owner-only permissions (0600). Never enter the token in chat.',
      );
      console.log(
        `Alternatively inherit ${result.profile.tokenEnv} when starting Codex. No token was read or stored by this command.`,
      );
      console.log(
        'Call list_servers in the existing chat; no plugin reinstall is needed.',
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
