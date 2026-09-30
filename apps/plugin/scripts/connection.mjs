import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

export const cloudUrl = 'https://playrunner.cloud/mcp';

export function connectionOptions(options = {}) {
  if (options.server === undefined) {
    if (options.name || options.auth || options.tokenEnv)
      throw new Error('--server is required with connection options.');
    return null;
  }
  let url;
  try {
    url = new URL(options.server);
  } catch {
    throw new Error('Server must be an absolute HTTPS URL.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      'Use HTTPS (or loopback HTTP), without credentials, query or fragment.',
    );
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/mcp') ? path : `${path}/mcp`;
  const endpoint = url.href;
  const suffix =
    options.name ??
    `server-${url.hostname.replace(/[^a-z0-9]+/g, '-').slice(0, 25)}-${createHash('sha256').update(endpoint).digest('hex').slice(0, 6)}`;
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(suffix))
    throw new Error(
      'Connection name must start with a lowercase letter and contain at most 40 lowercase letters, digits or hyphens.',
    );
  const name = `playrunner-${suffix}`;
  const auth = options.auth ?? (endpoint === cloudUrl ? 'oauth' : 'token');
  if (!['oauth', 'token'].includes(auth))
    throw new Error('Authentication must be token or oauth.');
  if (auth === 'oauth' && options.tokenEnv)
    throw new Error('--token-env cannot be used with OAuth.');
  const tokenEnv =
    auth === 'token'
      ? (options.tokenEnv ??
        `${name.replaceAll('-', '_').toUpperCase()}_API_TOKEN`)
      : undefined;
  if (tokenEnv && !/^[A-Z_][A-Z0-9_]*$/.test(tokenEnv))
    throw new Error(
      '--token-env must be an environment variable name, never a token value.',
    );
  return {
    name,
    url: endpoint,
    auth,
    ...(tokenEnv ? { tokenEnv } : {}),
    mode: endpoint === cloudUrl ? 'cloud' : 'self-hosted',
  };
}

export function parseConnectionArgs(args) {
  const { values } = parseArgs({
    args,
    options: {
      server: { type: 'string' },
      name: { type: 'string' },
      auth: { type: 'string' },
      'token-env': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) return { help: true };
  return {
    connection: connectionOptions({ ...values, tokenEnv: values['token-env'] }),
  };
}

export const connectionHelp = `Options:
  --server URL       Playrunner origin or MCP endpoint (HTTPS; loopback HTTP allowed)
  --name NAME        Server profile name; supports several servers in one plugin
  --auth token|oauth Default: token for self-hosted, OAuth for playrunner.cloud
  --token-env NAME   Optional inherited token variable name; never pass its value
Install once without --server; use scripts/connect.mjs --server URL --name NAME
(or npm run plugin:server -- --server URL --name NAME from the repository).
Server profiles reload at runtime; use list_servers and select_server in the chat.
Self-hosted profiles require token auth; Cloud keeps its native OAuth connection.
A private server-bound credential file can be updated without restarting Codex.`;
