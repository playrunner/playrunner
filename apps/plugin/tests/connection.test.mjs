import assert from 'node:assert/strict';
import test from 'node:test';
import {
  connectionOptions,
  parseConnectionArgs,
} from '../scripts/connection.mjs';
const options = {
  server: 'https://runner.example.test',
  name: 'team',
  tokenEnv: 'TEAM_RUNNER_TOKEN',
};
const connection = connectionOptions(options);

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
