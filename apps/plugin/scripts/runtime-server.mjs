import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import {
  readServers,
  serverToken,
  registryPath,
  cloudServer,
} from './server-registry.mjs';

const version = '2025-06-18';
const maximumBytes = 4 * 1024 * 1024;
const serverId = {
  type: 'string',
  description:
    'Exact ID returned by list_servers. Required on every remote call; no implicit default.',
};
const readHints = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
const tools = [
  {
    name: 'list_servers',
    description:
      'List configured Playrunner servers. Reloads configuration immediately; never returns tokens. Cloud uses the plugin native OAuth tools.',
    annotations: readHints,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'select_server',
    description:
      'Select a configured server as an advisory preference for this router process. Returns routing information, not proof of authentication. The process may be shared by chats; every remote call must still include serverId.',
    annotations: { ...readHints, readOnlyHint: false },
    inputSchema: {
      type: 'object',
      properties: { serverId },
      required: ['serverId'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_server_tools',
    description:
      'Read available tool schemas from a configured self-hosted Playrunner server before calling them. Use native playrunner tools for Cloud.',
    annotations: readHints,
    inputSchema: {
      type: 'object',
      properties: { serverId },
      required: ['serverId'],
      additionalProperties: false,
    },
  },
  {
    name: 'call_server_tool',
    description:
      'Call a discovered tool on the explicitly named self-hosted server. May create, modify, delete or run workflows; obtain authorization appropriate to the underlying tool. Never retry an ambiguous mutation automatically. Cloud uses native playrunner tools.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        serverId,
        tool: { type: 'string' },
        arguments: { type: 'object', additionalProperties: true },
      },
      required: ['serverId', 'tool', 'arguments'],
      additionalProperties: false,
    },
  },
];
const success = (value) => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
  structuredContent: value,
});
const failure = (text) => ({
  content: [{ type: 'text', text }],
  isError: true,
});
function redact(value, token) {
  if (typeof value === 'string') return value.replaceAll(token, '[redacted]');
  if (Array.isArray(value)) return value.map((item) => redact(item, token));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        redact(key, token),
        redact(item, token),
      ]),
    );
  return value;
}

async function readJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Server returned an empty MCP response.');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximumBytes)
        throw new Error('Server MCP response exceeds the size limit.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error(
      'Server did not return a JSON MCP response. This router supports the standalone Playrunner HTTP interface.',
    );
  }
}

export function createRuntimeRouter({
  file = registryPath(),
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = 30000,
} = {}) {
  let selected = null;
  let nextId = 0;
  const sessions = new Map();
  const profiles = async () => [
    cloudServer,
    ...(await readServers(file)).map((server) => ({
      ...server,
      auth: 'token',
      transport: 'router',
    })),
  ];
  async function lookup(id) {
    const server = (await profiles()).find((server) => server.id === id);
    if (!server)
      throw new Error(
        'Unknown serverId. Call list_servers and select a configured server.',
      );
    return server;
  }
  async function remote(server, method, params = {}) {
    if (server.transport === 'native')
      throw new Error(
        'Cloud uses the native playrunner OAuth tools. Do not send Cloud credentials through this router.',
      );
    const token = await serverToken(server, file, env);
    const key = createHash('sha256')
      .update(`${server.url}\0${token}`)
      .digest('hex');
    let session =
      sessions.get(server.id)?.key === key
        ? sessions.get(server.id)
        : undefined;
    async function request(rpcMethod, rpcParams, notification = false) {
      const id = ++nextId;
      let response;
      try {
        response = await fetchImpl(server.url, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            accept: 'application/json',
            ...(session?.protocol
              ? { 'mcp-protocol-version': session.protocol }
              : {}),
            ...(session?.id ? { 'mcp-session-id': session.id } : {}),
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            ...(notification ? {} : { id }),
            method: rpcMethod,
            params: rpcParams,
          }),
        });
      } catch {
        throw new Error(
          `Request to ${server.id} failed or timed out. Its outcome may be unknown; do not repeat a mutation automatically.`,
        );
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(
          `Server ${server.id} returned HTTP ${response.status}. No other server was contacted.`,
        );
      }
      if (notification) {
        await response.body?.cancel();
        return;
      }
      let body;
      try {
        body = await readJson(response);
      } catch {
        throw new Error(
          `Server ${server.id} returned an unreadable, oversized or interrupted JSON response. Its outcome may be unknown; do not repeat a mutation automatically.`,
        );
      }
      if (
        !body ||
        body.jsonrpc !== '2.0' ||
        body.id !== id ||
        body.error ||
        !body.result
      )
        throw new Error(
          `Server ${server.id} rejected or returned an invalid MCP response.`,
        );
      if (rpcMethod === 'initialize') {
        session = {
          key,
          id: response.headers.get('mcp-session-id'),
          protocol: body.result.protocolVersion,
        };
        sessions.set(server.id, session);
      }
      // Even a misconfigured upstream must not echo the supplied credential.
      return redact(body.result, token);
    }
    if (!session) {
      await request('initialize', {
        protocolVersion: version,
        capabilities: {},
        clientInfo: { name: 'playrunner-runtime-router', version: '0.2.0' },
      });
      await request('notifications/initialized', {}, true);
    }
    return request(method, params);
  }
  async function invoke(name, args = {}) {
    if (name === 'list_servers')
      return success({ selectedServerId: selected, servers: await profiles() });
    const server = await lookup(args.serverId);
    if (name === 'select_server') {
      selected = server.id;
      return success({
        selectedServerId: selected,
        server,
        authenticated: false,
        next:
          server.transport === 'native'
            ? 'Use the native playrunner tools and get_account.'
            : 'Use list_server_tools, then call_server_tool with this serverId.',
      });
    }
    async function discover() {
      const found = [];
      let cursor;
      for (let page = 0; page < 20; page++) {
        const result = await remote(
          server,
          'tools/list',
          cursor ? { cursor } : {},
        );
        if (!Array.isArray(result.tools))
          throw new Error('Server returned an invalid tools list.');
        found.push(...result.tools);
        if (!result.nextCursor) return { tools: found };
        if (
          typeof result.nextCursor !== 'string' ||
          result.nextCursor === cursor
        )
          break;
        cursor = result.nextCursor;
      }
      throw new Error('Server tool pagination did not complete.');
    }
    if (name === 'list_server_tools')
      return success({ ...(await discover()), serverId: server.id });
    if (name === 'call_server_tool') {
      if (
        typeof args.tool !== 'string' ||
        !args.arguments ||
        typeof args.arguments !== 'object' ||
        Array.isArray(args.arguments)
      )
        throw new Error('tool and arguments are required.');
      // Resolve once per operation: a selection/configuration change cannot retarget an in-flight call.
      const discovery = await discover();
      if (!discovery.tools?.some((tool) => tool.name === args.tool))
        throw new Error('This tool is not available on the selected server.');
      const result = await remote(server, 'tools/call', {
        name: args.tool,
        arguments: args.arguments,
      });
      return {
        ...success({ serverId: server.id, result }),
        ...(result.isError ? { isError: true } : {}),
      };
    }
    throw new Error('Unknown router tool.');
  }
  return async (message) => {
    const id = message?.id ?? null;
    const error = (code, text) => ({
      jsonrpc: '2.0',
      id,
      error: { code, message: text },
    });
    if (
      !message ||
      Array.isArray(message) ||
      message.jsonrpc !== '2.0' ||
      typeof message.method !== 'string'
    )
      return error(-32600, 'Invalid JSON-RPC request.');
    if (message.id === undefined || message.id === null) return null;
    let result;
    if (message.method === 'initialize')
      result = {
        protocolVersion: ['2025-06-18', '2025-03-26'].includes(
          message.params?.protocolVersion,
        )
          ? message.params.protocolVersion
          : version,
        capabilities: { tools: {} },
        serverInfo: { name: 'playrunner-servers', version: '0.2.0' },
        instructions:
          'List configured servers. Every routed call must name its serverId. Cloud uses the separate native playrunner OAuth tools.',
      };
    else if (message.method === 'ping') result = {};
    else if (message.method === 'tools/list') result = { tools };
    else if (message.method === 'tools/call') {
      try {
        result = await invoke(message.params?.name, message.params?.arguments);
      } catch (caught) {
        result = failure(caught.message);
      }
    } else return error(-32601, 'Method not found.');
    return { jsonrpc: '2.0', id, result };
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  const route = createRuntimeRouter();
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    let response;
    try {
      if (Buffer.byteLength(line) > maximumBytes) throw new Error();
      response = await route(JSON.parse(line));
    } catch {
      response = {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Invalid or oversized JSON.' },
      };
    }
    if (response) process.stdout.write(JSON.stringify(response) + '\n');
  }
}
