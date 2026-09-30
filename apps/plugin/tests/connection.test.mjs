import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  rm,
  access,
  mkdir,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  connectionOptions,
  parseConnectionArgs,
  mcpAddArgs,
  existingConnection,
} from '../scripts/connection.mjs';
import { packagePlugin } from '../scripts/package.mjs';
import { installPlugin } from '../scripts/install.mjs';

const options = {
  server: 'https://runner.example.test',
  name: 'team',
  tokenEnv: 'TEAM_RUNNER_TOKEN',
};
const connection = connectionOptions(options);
const configured = {
  name: connection.name,
  transport: {
    type: 'streamable_http',
    url: connection.url,
    bearer_token_env_var: connection.tokenEnv,
  },
};

test('normalizes endpoints and selects authentication without reading tokens', () => {
  assert.equal(connection.url, 'https://runner.example.test/mcp');
  assert.equal(connection.auth, 'token');
  assert.equal(connection.name, 'playrunner-team');
  assert.deepEqual(
    connectionOptions({
      ...options,
      server: 'https://runner.example.test/mcp/',
    }),
    connection,
  );
  assert.equal(
    connectionOptions({ server: 'http://127.0.0.1:3013' }).url,
    'http://127.0.0.1:3013/mcp',
  );
  assert.equal(
    connectionOptions({ server: 'https://runner.example.test/playrunner/' })
      .url,
    'https://runner.example.test/playrunner/mcp',
  );
  assert.equal(
    connectionOptions({ server: 'https://playrunner.cloud' }).auth,
    'oauth',
  );
  assert.equal(
    connectionOptions({ ...options, tokenEnv: undefined, auth: 'oauth' })
      .tokenEnv,
    undefined,
  );
  assert.equal(connectionOptions(), null);
  assert.notEqual(
    connectionOptions({ server: 'https://runner.example.test/a' }).name,
    connectionOptions({ server: 'https://runner.example.test/b' }).name,
  );
  assert.deepEqual(
    parseConnectionArgs([
      '--server',
      options.server,
      '--name',
      'team',
      '--token-env',
      'TEAM_RUNNER_TOKEN',
    ]),
    { connection },
  );
  assert.deepEqual(mcpAddArgs(connection), [
    'mcp',
    'add',
    'playrunner-team',
    '--url',
    'https://runner.example.test/mcp',
    '--bearer-token-env-var',
    'TEAM_RUNNER_TOKEN',
  ]);
});

test('rejects credential-bearing, insecure, malformed and ambiguous options', () => {
  for (const server of [
    'http://runner.example.test',
    'https://user:password@runner.example.test',
    'https://runner.example.test?token=secret',
    'https://runner.example.test#secret',
    'file:///tmp/mcp',
    'not a url',
    '',
  ])
    assert.throws(() => connectionOptions({ server }));
  for (const extra of [
    { name: '../other' },
    { tokenEnv: 'secret value' },
    { tokenEnv: 'pr_live_example' },
    { auth: 'none' },
    { auth: 'oauth', tokenEnv: 'TOKEN' },
  ])
    assert.throws(() => connectionOptions({ ...options, ...extra }));
  assert.throws(() => connectionOptions({ name: 'unused' }));
  assert.throws(() => parseConnectionArgs(['--token', 'value']));
});

test('never replaces a differently configured connection or credentials', () => {
  assert.equal(existingConnection([], connection), false);
  assert.equal(existingConnection([configured], connection), true);
  assert.throws(
    () => existingConnection([{ ...configured, enabled: false }], connection),
    /disabled/,
  );
  for (const patch of [
    { url: 'https://other.example.test/mcp' },
    { type: 'stdio' },
    { bearer_token_env_var: 'OTHER_TOKEN' },
    { http_headers: { Authorization: 'secret' } },
    { env_http_headers: { Authorization: 'OTHER_TOKEN' } },
  ])
    assert.throws(
      () =>
        existingConnection(
          [{ ...configured, transport: { ...configured.transport, ...patch } }],
          connection,
        ),
      /different settings/,
    );
});

test('self-hosted package has a named skill, no Cloud connection and no public submission', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'playrunner-connection-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = await packagePlugin(dir, { connection });
  assert.equal(result.submissionZip, undefined);
  assert.equal(result.skillZip, undefined);
  const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
  const catalog = await json(
    join(result.marketplaceRoot, '.agents/plugins/marketplace.json'),
  );
  const manifest = await json(
    join(result.destination, '.codex-plugin/plugin.json'),
  );
  assert.equal(catalog.name, 'playrunner-team');
  assert.equal(catalog.plugins[0].source.path, './plugins/playrunner-team');
  assert.equal(manifest.name, 'playrunner-team');
  assert.equal(manifest.mcpServers, undefined);
  for (const path of ['.mcp.json', 'mcp.json'])
    await assert.rejects(access(join(result.destination, path)));
  assert.deepEqual(
    await json(join(result.destination, 'skills/playrunner/connection.json')),
    connection,
  );
  assert.match(
    await readFile(
      join(result.destination, 'skills/playrunner/SKILL.md'),
      'utf8',
    ),
    /name: playrunner-team\n/,
  );
});

test('installs a named connection alongside existing Cloud without replacing it', async () => {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    if (args[0] === 'mcp' && args[1] === 'list')
      return JSON.stringify([
        {
          name: 'playrunner',
          transport: { url: 'https://playrunner.cloud/mcp' },
        },
      ]);
    return JSON.stringify({ marketplaces: [{ name: 'playrunner' }] });
  };
  await installPlugin({
    connection,
    run,
    build: async (_output, opts) => {
      assert.deepEqual(opts.connection, connection);
      return { marketplaceRoot: '/generated/team' };
    },
  });
  assert.deepEqual(calls, [
    ['mcp', 'list', '--json'],
    ['plugin', 'marketplace', 'list', '--json'],
    ['plugin', 'marketplace', 'add', '/generated/team'],
    mcpAddArgs(connection),
    ['plugin', 'add', 'playrunner-team@playrunner-team'],
  ]);
});

test('conflicting server fails before packaging or mutations', async () => {
  await assert.rejects(
    installPlugin({
      connection,
      run: (args) => {
        assert.deepEqual(args, ['mcp', 'list', '--json']);
        return JSON.stringify([
          {
            ...configured,
            transport: {
              ...configured.transport,
              url: 'https://other.example.test/mcp',
            },
          },
        ]);
      },
      build: async () => {
        assert.fail('must not package');
      },
    }),
    /different settings/,
  );
});

test('failed install removes only the connection it created; preserves an existing one', async () => {
  for (const existing of [false, true]) {
    const calls = [];
    await assert.rejects(
      installPlugin({
        connection,
        build: async () => ({ marketplaceRoot: '/generated/team' }),
        run: (args) => {
          calls.push(args);
          if (args[0] === 'mcp' && args[1] === 'list')
            return JSON.stringify(existing ? [configured] : []);
          if (args[0] === 'plugin' && args[1] === 'add')
            throw new Error('install failed');
          return JSON.stringify({ marketplaces: [] });
        },
      }),
      /install failed/,
    );
    assert.equal(
      calls.some((args) => args[0] === 'mcp' && args[1] === 'remove'),
      !existing,
    );
  }
});

test('extracted server package configures Codex through its bundled setup script', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'playrunner-extracted-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = await packagePlugin(join(dir, 'dist'), { connection });
  const extracted = join(dir, 'unpacked');
  await mkdir(extracted);
  const unpack = spawnSync('tar', ['-xzf', result.archive, '-C', extracted]);
  assert.equal(unpack.status, 0);
  const bin = join(dir, 'bin');
  await mkdir(bin);
  const callsPath = join(dir, 'calls.jsonl');
  await writeFile(
    join(bin, 'codex'),
    `#!${process.execPath}
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.TEST_CALLS, JSON.stringify(process.argv.slice(2)) + '\\n');
console.log('[]');
`,
    { mode: 0o755 },
  );
  const script = join(
    extracted,
    'playrunner-team-plugin-0.1.2/plugins/playrunner-team/scripts/connect.mjs',
  );
  const run = spawnSync(process.execPath, [script], {
    env: {
      ...process.env,
      PATH: bin,
      TEST_CALLS: callsPath,
      TEAM_RUNNER_TOKEN: 'fixture-secret-do-not-print',
    },
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  const raw = await readFile(callsPath, 'utf8');
  const calls = raw
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(calls, [['mcp', 'list', '--json'], mcpAddArgs(connection)]);
  assert.doesNotMatch(
    raw + run.stdout + run.stderr,
    /fixture-secret-do-not-print/,
  );
  assert.match(run.stdout, /TEAM_RUNNER_TOKEN/);
});
