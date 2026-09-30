import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  rm,
  readFile,
  writeFile,
  chmod,
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { connectionOptions } from '../scripts/connection.mjs';
import {
  configureServer,
  credentialPath,
  readServers,
} from '../scripts/server-registry.mjs';
import { createRuntimeRouter } from '../scripts/runtime-server.mjs';
import { packagePlugin } from '../scripts/package.mjs';
import { installPlugin } from '../scripts/install.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'playrunner-runtime-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'codex-servers.json');
  const route = createRuntimeRouter({ file, env: {} });
  let id = 0;
  const call = async (name, args = {}) =>
    (
      await route({
        jsonrpc: '2.0',
        id: ++id,
        method: 'tools/call',
        params: { name, arguments: args },
      })
    ).result;
  return { dir, file, route, call };
}

async function server(t, f, name) {
  const token = randomBytes(24).toString('hex') + '"\\end';
  const calls = [];
  let fault = null;
  const http = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const rpc = JSON.parse(raw);
    // Retain only equality evidence, not the actual credential.
    calls.push({
      ...rpc,
      authorized: req.headers.authorization === `Bearer ${token}`,
      session: req.headers['mcp-session-id'],
    });
    if (fault === 'redirect') {
      res.writeHead(307, {
        location: `http://127.0.0.1:${http.address().port}/redirected`,
      });
      res.end();
      return;
    }
    if (fault === 'unauthorized') {
      res.writeHead(401);
      res.end();
      return;
    }
    if (fault === 'malformed') {
      res.end('not json');
      return;
    }
    if (fault === 'rpc-error') {
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: rpc.id,
          error: { code: -32000, message: token },
        }),
      );
      return;
    }
    if (rpc.id === undefined) {
      res.writeHead(202);
      res.end();
      return;
    }
    let result;
    if (rpc.method === 'initialize')
      result = {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name, version: '1' },
      };
    if (rpc.method === 'tools/list')
      result = rpc.params?.cursor
        ? { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }
        : {
            tools: [
              { name: 'list_workflows', inputSchema: { type: 'object' } },
            ],
            nextCursor: 'page2',
          };
    if (rpc.method === 'tools/call')
      result = {
        content: [{ type: 'text', text: `${name}:${rpc.params.name}` }],
        structuredContent: {
          name,
          arguments: rpc.params.arguments,
          echo: token,
        },
        ...(fault === 'tool-error' ? { isError: true } : {}),
      };
    res.writeHead(200, {
      'content-type': 'application/json',
      'mcp-session-id': `${name}-session`,
    });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
  });
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    http.closeAllConnections();
    return new Promise((resolve) => http.close(resolve));
  });
  const connection = connectionOptions({
    server: `http://127.0.0.1:${http.address().port}`,
    name,
  });
  await configureServer(connection, f.file);
  const path = credentialPath(f.file, connection.name);
  const credential = JSON.stringify({ url: connection.url, token });
  await writeFile(path, credential, { mode: 0o600 });
  return {
    id: connection.name,
    calls,
    path,
    connection,
    credential,
    token,
    fault: (value) => {
      fault = value;
    },
  };
}

const execute = (f, id, tool = 'list_workflows', args = {}) =>
  f.call('call_server_tool', { serverId: id, tool, arguments: args });

test('switches two live HTTP servers without restart, hot-loads profiles and isolates credentials', async (t) => {
  const f = await fixture(t);
  const a = await server(t, f, 'alpha');
  const selected = await f.call('select_server', { serverId: a.id });
  assert.equal(selected.structuredContent.authenticated, false);
  assert.equal(
    (await execute(f, a.id)).structuredContent.result.structuredContent.name,
    'alpha',
  );
  const b = await server(t, f, 'beta'); // Added after the router has already made a call.
  assert.equal(
    (await f.call('list_servers')).structuredContent.servers.length,
    3,
  );
  await f.call('select_server', { serverId: b.id });
  const [resultA, resultB] = await Promise.all([
    execute(f, a.id, 'echo', { value: 'alpha' }),
    execute(f, b.id, 'echo', { value: 'beta' }),
  ]);
  for (const [result, s, name] of [
    [resultA, a, 'alpha'],
    [resultB, b, 'beta'],
  ]) {
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.serverId, s.id);
    assert.equal(result.structuredContent.result.structuredContent.name, name);
    assert.equal(
      result.structuredContent.result.structuredContent.echo,
      '[redacted]',
    );
    assert.equal(
      s.calls.every((c) => c.authorized),
      true,
    );
    assert.equal(s.calls.filter((c) => c.method === 'initialize').length, 1);
    assert.equal(
      s.calls.find((c) => c.method === 'tools/call').session,
      `${name}-session`,
    );
    assert.equal(JSON.stringify(result).includes(s.token), false);
  }
  assert.equal((await execute(f, undefined)).isError, true);
  assert.equal((await execute(f, 'unconfigured')).isError, true);
  assert.equal((await execute(f, a.id, 'nonexistent')).isError, true);
  assert.equal(a.calls.filter((c) => c.method === 'tools/call').length, 2);
  const registry = await readFile(f.file, 'utf8');
  assert.equal(registry.includes(a.token) || registry.includes(b.token), false);
  // A second router has no inherited selection, but sees the same profiles.
  const second = createRuntimeRouter({ file: f.file, env: {} });
  const listed = await second({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'list_servers' },
  });
  assert.equal(listed.result.structuredContent.selectedServerId, null);
});

test('Cloud remains native OAuth and unknown targets never contact another server', async (t) => {
  const f = await fixture(t);
  const a = await server(t, f, 'alpha');
  const selected = await f.call('select_server', { serverId: 'cloud' });
  assert.equal(selected.structuredContent.server.transport, 'native');
  assert.equal((await execute(f, 'cloud')).isError, true);
  assert.equal(
    (await execute(f, 'https://arbitrary.example.test')).isError,
    true,
  );
  assert.equal(a.calls.length, 0);
});

test('credential changes are hot-loaded, bound to the endpoint and checked before network access', async (t) => {
  const f = await fixture(t);
  const a = await server(t, f, 'alpha');
  await writeFile(
    a.path,
    JSON.stringify({ url: 'https://other.example.test/mcp', token: a.token }),
  );
  assert.equal((await execute(f, a.id)).isError, true);
  await rm(a.path);
  assert.equal((await execute(f, a.id)).isError, true);
  await writeFile(a.path, a.credential, { mode: 0o600 });
  if (process.platform !== 'win32') {
    await chmod(a.path, 0o644);
    assert.equal((await execute(f, a.id)).isError, true);
    await chmod(a.path, 0o600);
  }
  assert.equal(a.calls.length, 0);
  assert.equal((await execute(f, a.id)).isError, undefined);
});

test('redirects, auth failures and invalid upstream responses never retry or fall back', async (t) => {
  const f = await fixture(t);
  const a = await server(t, f, 'alpha');
  const b = await server(t, f, 'beta');
  for (const fault of ['redirect', 'unauthorized', 'malformed', 'rpc-error']) {
    a.fault(fault);
    const before = a.calls.length;
    const result = await execute(f, a.id);
    assert.equal(result.isError, true);
    assert.equal(a.calls.length, before + 1);
    assert.equal(JSON.stringify(result).includes(a.token), false);
    assert.equal(b.calls.length, 0);
  }
  a.fault('tool-error');
  const result = await execute(f, a.id);
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.result.isError, true);
});

test('registry setup is idempotent and refuses credential retargeting or malformed profiles', async (t) => {
  const f = await fixture(t);
  const connection = connectionOptions({
    server: 'https://runner.example.test',
    name: 'team',
  });
  await configureServer(connection, f.file);
  await configureServer(connection, f.file);
  assert.equal((await readServers(f.file)).length, 1);
  await assert.rejects(
    configureServer(
      { ...connection, url: 'https://other.example.test/mcp' },
      f.file,
    ),
    /different settings/,
  );
  await assert.rejects(
    configureServer(
      connectionOptions({ server: 'https://playrunner.cloud' }),
      f.file,
    ),
    /native OAuth/,
  );
  for (const value of [
    null,
    { version: 2, servers: [] },
    { version: 1, servers: [{ id: 'playrunner-team' }] },
    {
      version: 1,
      servers: [
        { id: 'playrunner-team', url: connection.url, token: 'not-allowed' },
      ],
    },
  ]) {
    await writeFile(f.file, JSON.stringify(value));
    assert.equal((await f.call('list_servers')).isError, true);
  }
});

test('extracted generic plugin configures profiles and starts its stdio router independently', async (t) => {
  const f = await fixture(t);
  const result = await packagePlugin(join(f.dir, 'dist'));
  await assert.rejects(
    packagePlugin(join(f.dir, 'dist'), {
      connection: connectionOptions({ server: 'https://runner.example.test' }),
    }),
    /all configured servers/,
  );
  const unpacked = join(f.dir, 'unpacked');
  await mkdir(unpacked);
  assert.equal(
    spawnSync('tar', ['-xzf', result.archive, '-C', unpacked]).status,
    0,
  );
  const installed = join(
    unpacked,
    'playrunner-plugin-0.2.0/plugins/playrunner',
  );
  const setup = spawnSync(
    process.execPath,
    [
      join(installed, 'scripts/connect.mjs'),
      '--server',
      'https://runner.example.test',
      '--name',
      'team',
    ],
    {
      cwd: f.dir,
      env: { ...process.env, PLAYRUNNER_SERVERS_FILE: f.file },
      encoding: 'utf8',
    },
  );
  assert.equal(setup.status, 0, setup.stderr);
  assert.match(setup.stdout, /no plugin reinstall/);
  for (const file of ['.mcp.json', 'mcp.json']) {
    const manifest = JSON.parse(await readFile(join(installed, file), 'utf8'));
    assert.equal(
      manifest.mcpServers.playrunner.url,
      'https://playrunner.cloud/mcp',
    );
    const runtime = manifest.mcpServers.playrunner_servers;
    assert.equal(runtime.command, 'node');
    const run = spawnSync(process.execPath, runtime.args, {
      cwd: join(installed, runtime.cwd),
      env: { ...process.env, PLAYRUNNER_SERVERS_FILE: f.file },
      input: [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-06-18' },
        },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'list_servers', arguments: {} },
        },
      ]
        .map((value) => JSON.stringify(value) + '\n')
        .join(''),
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stderr, '');
    const responses = run.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(responses.length, 3);
    assert.equal(responses[1].result.tools.length, 4);
    assert.equal(
      responses[2].result.structuredContent.servers[1].id,
      'playrunner-team',
    );
  }
});

test('installer uses one plugin for configured servers without creating named MCP connections', async (t) => {
  const f = await fixture(t);
  const calls = [];
  await installPlugin({
    connection: connectionOptions({
      server: 'https://runner.example.test',
      name: 'team',
    }),
    file: f.file,
    build: async () => ({ marketplaceRoot: '/generated/playrunner' }),
    run: (args) => {
      calls.push(args);
      return JSON.stringify({ marketplaces: [] });
    },
  });
  assert.deepEqual(calls, [
    ['plugin', 'marketplace', 'list', '--json'],
    ['plugin', 'marketplace', 'add', '/generated/playrunner'],
    ['plugin', 'add', 'playrunner@playrunner'],
  ]);
  assert.equal((await readServers(f.file))[0].id, 'playrunner-team');
});
