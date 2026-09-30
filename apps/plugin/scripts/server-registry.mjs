import { readFile, mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { connectionOptions, cloudUrl } from './connection.mjs';

export const registryPath = () =>
  resolve(
    process.env.PLAYRUNNER_SERVERS_FILE ||
      join(homedir(), '.config/playrunner/codex-servers.json'),
  );
export const cloudServer = {
  id: 'cloud',
  url: cloudUrl,
  auth: 'oauth',
  transport: 'native',
  connectionName: 'playrunner',
};
export const credentialPath = (file, id) =>
  join(dirname(file), 'credentials', `${id}.json`);

export async function readServers(file = registryPath()) {
  let document;
  try {
    document = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error(
      'Cannot read the Playrunner server registry. Fix its JSON before continuing.',
    );
  }
  if (!document || document.version !== 1 || !Array.isArray(document.servers))
    throw new Error(
      'Unsupported Playrunner server registry. Expected version 1 and a servers array.',
    );
  const ids = new Set();
  return document.servers.map((server) => {
    if (
      !server ||
      typeof server !== 'object' ||
      Object.keys(server).some(
        (key) => !['id', 'url', 'tokenEnv'].includes(key),
      )
    )
      throw new Error(
        'Server entries contain only id, url and optional tokenEnv; never store tokens in the registry.',
      );
    if (typeof server.id !== 'string' || !server.id.startsWith('playrunner-'))
      throw new Error('Invalid configured server ID.');
    if (typeof server.url !== 'string' || !server.url)
      throw new Error('Each server must have an endpoint URL.');
    const normalized = connectionOptions({
      server: server.url,
      name: server.id.slice(11),
      tokenEnv: server.tokenEnv,
      auth: 'token',
    });
    if (normalized.url === cloudUrl || ids.has(server.id))
      throw new Error(
        'Duplicate server ID or Cloud endpoint in the self-hosted registry.',
      );
    ids.add(server.id);
    return {
      id: server.id,
      url: normalized.url,
      tokenEnv: normalized.tokenEnv,
    };
  });
}

export async function configureServer(connection, file = registryPath()) {
  if (!connection || connection.auth !== 'token' || connection.url === cloudUrl)
    throw new Error(
      'Runtime profiles use self-hosted API tokens. Cloud already uses the native OAuth connection.',
    );
  // A short exclusive lock prevents two setup commands losing each other's changes.
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  let lock;
  try {
    lock = await open(`${file}.lock`, 'wx', 0o600);
  } catch {
    throw new Error(
      'Another server configuration is in progress. Retry after it completes.',
    );
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const servers = await readServers(file);
    const profile = {
      id: connection.name,
      url: connection.url,
      tokenEnv: connection.tokenEnv,
    };
    const existing = servers.find((server) => server.id === profile.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(profile))
      throw new Error(
        'This server name has different settings. Use a new --name; existing credentials will not be retargeted.',
      );
    if (!existing) {
      const output = await open(temporary, 'wx', 0o600);
      try {
        await output.writeFile(
          JSON.stringify(
            { version: 1, servers: [...servers, profile] },
            null,
            2,
          ) + '\n',
        );
      } finally {
        await output.close();
      }
      await rename(temporary, file);
    }
    await mkdir(join(dirname(file), 'credentials'), {
      recursive: true,
      mode: 0o700,
    });
    return { profile, credentialFile: credentialPath(file, profile.id) };
  } finally {
    await rm(temporary, { force: true });
    await lock.close();
    await rm(`${file}.lock`, { force: true });
  }
}

export async function serverToken(
  server,
  file = registryPath(),
  env = process.env,
) {
  // Runtime only: never expose credential contents through tools or setup output.
  const inherited = env[server.tokenEnv];
  if (inherited) return inherited;
  const path = credentialPath(file, server.id);
  let metadata;
  try {
    metadata = await stat(path);
  } catch {
    throw new Error(
      `Credentials are missing for ${server.id}. Configure its private credential file or inherited ${server.tokenEnv} variable.`,
    );
  }
  if (
    !metadata.isFile() ||
    (process.platform !== 'win32' &&
      (metadata.mode & 0o077 || metadata.uid !== process.getuid()))
  )
    throw new Error(
      `Credentials for ${server.id} must be an owner-only file (mode 0600).`,
    );
  let credential;
  try {
    credential = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error(`Invalid credential file for ${server.id}.`);
  }
  if (
    !credential ||
    credential.url !== server.url ||
    typeof credential.token !== 'string' ||
    !credential.token.trim()
  )
    throw new Error(
      `Credentials for ${server.id} must contain this exact server URL and a nonempty token.`,
    );
  return credential.token;
}
