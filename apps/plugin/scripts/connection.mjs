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
  --name NAME        Connection name; allows several servers side by side
  --auth token|oauth Default: token for self-hosted, OAuth for playrunner.cloud
  --token-env NAME   Environment variable containing the token; never pass its value
Without --server, the existing Playrunner Cloud plugin is packaged/installed.
Self-hosted installs register a named HTTP MCP connection and a matching skill plugin.
Supply the token securely in the environment of the Codex process before connecting.`;

export function mcpAddArgs(connection) {
  return [
    'mcp',
    'add',
    connection.name,
    '--url',
    connection.url,
    ...(connection.tokenEnv
      ? ['--bearer-token-env-var', connection.tokenEnv]
      : []),
  ];
}

// Inspect only transport metadata. Never return or print configured headers/tokens.
export function existingConnection(listing, connection) {
  if (!Array.isArray(listing))
    throw new Error('Codex did not return a valid MCP connection list.');
  const matches = listing.filter((entry) => entry.name === connection.name);
  if (!matches.length) return false;
  const entry = matches[0];
  if (entry.enabled === false)
    throw new Error(
      'That MCP connection is disabled. Enable it in Codex settings before using this plugin; no settings were changed.',
    );
  if (
    matches.length !== 1 ||
    entry.transport?.type !== 'streamable_http' ||
    entry.transport.url !== connection.url ||
    (entry.transport.bearer_token_env_var || null) !==
      (connection.tokenEnv || null) ||
    Object.keys(entry.transport.http_headers || {}).length ||
    Object.keys(entry.transport.env_http_headers || {}).length
  )
    throw new Error(
      'That MCP connection name already has different settings. Choose another --name; no connection was changed.',
    );
  return true;
}
