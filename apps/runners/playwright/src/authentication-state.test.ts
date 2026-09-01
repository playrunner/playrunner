import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  fetchAuthenticationState,
  prepareAuthenticationState,
} from './authentication-state';
import { sealAuthenticationEnvelope } from '../../shared/authentication-envelope';

const state = {
  cookies: [
    {
      domain: 'example.test',
      expires: -1,
      httpOnly: true,
      name: 'session',
      path: '/',
      sameSite: 'Lax',
      secure: true,
      value: 'secret-cookie',
    },
  ],
  origins: [],
};

test('materializes TypeScript state outside the repository and cleans it up', () => {
  const workingDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'playrunner-suite-'),
  );
  const prepared = prepareAuthenticationState({
    runtime: 'typescript',
    state,
    workingDir,
  });
  try {
    assert.equal(prepared.statePath.startsWith(workingDir), false);
    assert.equal(fs.statSync(prepared.statePath).mode & 0o777, 0o600);
    assert.match(fs.readFileSync(prepared.configPath!, 'utf8'), /storageState/);
    assert.equal(
      fs.readFileSync(prepared.configPath!, 'utf8').includes('secret-cookie'),
      false,
    );
  } finally {
    const statePath = prepared.statePath;
    const configPath = prepared.configPath!;
    prepared.cleanup();
    assert.equal(fs.existsSync(statePath), false);
    assert.equal(fs.existsSync(configPath), false);
    fs.rmSync(workingDir, { force: true, recursive: true });
  }
});

test('creates a Python fixture plugin without embedding auth state', () => {
  const workingDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'playrunner-suite-'),
  );
  const prepared = prepareAuthenticationState({
    runtime: 'python',
    state,
    workingDir,
  });
  try {
    assert.ok(prepared.pythonPlugin);
    assert.ok(prepared.environment.PYTHONPATH);
    const pluginPath = path.join(
      path.dirname(prepared.statePath),
      `${prepared.pythonPlugin}.py`,
    );
    assert.equal(
      fs.readFileSync(pluginPath, 'utf8').includes('secret-cookie'),
      false,
    );
  } finally {
    prepared.cleanup();
    fs.rmSync(workingDir, { force: true, recursive: true });
  }
});

test('rejects malformed state before creating temporary files', () => {
  assert.throws(
    () =>
      prepareAuthenticationState({
        runtime: 'typescript',
        state: { cookies: [] },
        workingDir: process.cwd(),
      }),
    /state is invalid/,
  );
});

test('fetches auth state through an execution-bound sealed envelope', async () => {
  const fetched = await fetchAuthenticationState({
    editorApiUrl: 'http://api.test',
    executionId: 'execution-1',
    executionToken: 'execution-secret',
    fetcher: async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(
        (init?.headers as Record<string, string>)['x-execution-token'],
        'execution-secret',
      );
      return new Response(
        JSON.stringify({
          envelope: sealAuthenticationEnvelope({
            executionId: 'execution-1',
            nodeId: 'node-1',
            plaintext: Buffer.from(JSON.stringify(state), 'utf8'),
            recipientPublicKey: body.recipientPublicKey,
          }),
        }),
        { status: 200 },
      );
    },
    nodeId: 'node-1',
  });

  assert.deepEqual(fetched, state);
});
