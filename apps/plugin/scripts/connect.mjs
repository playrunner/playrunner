import { realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { existingConnection, mcpAddArgs } from './connection.mjs';

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

export function connectServer(connection, run = runCodex) {
  const exists = existingConnection(
    JSON.parse(run(['mcp', 'list', '--json'])),
    connection,
  );
  if (!exists) run(mcpAddArgs(connection));
  return { created: !exists };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  const connection = JSON.parse(
    await readFile(
      new URL('../skills/playrunner/connection.json', import.meta.url),
      'utf8',
    ),
  );
  connectServer(connection);
  console.log(`Configured ${connection.name} at ${connection.url}.`);
  if (connection.tokenEnv)
    console.log(
      `Supply ${connection.tokenEnv} securely in the Codex process environment, then start a new task. No token was read or stored by this command.`,
    );
  else
    console.log(
      `Use Codex's OAuth login for ${connection.name}, then start a new task.`,
    );
}
