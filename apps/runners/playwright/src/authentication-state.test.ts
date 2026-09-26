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

for (const runtime of ['typescript', 'python'] as const) {
  test(`${runtime} materializes independent sessions and cleans up every file`, () => {
    const workingDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'playrunner-suite-'),
    );
    const second = {
      cookies: [],
      origins: [
        {
          origin: 'https://steadfast.test',
          localStorage: [{ name: 'token', value: 'steadfast-secret' }],
        },
      ],
    };
    const prepared = prepareAuthenticationState({
      runtime,
      workingDir,
      state: {
        profiles: [
          {
            profileId: 'bunker',
            environmentVariable: 'E2E_REGRESSION_STORAGE_STATE',
            state,
          },
          {
            profileId: 'steadfast',
            environmentVariable: 'E2E_STEADFAST_STORAGE_STATE',
            state: second,
          },
        ],
      },
    });
    const paths = [
      prepared.environment.E2E_REGRESSION_STORAGE_STATE!,
      prepared.environment.E2E_STEADFAST_STORAGE_STATE!,
    ];
    try {
      assert.equal(paths[0], prepared.statePath);
      assert.notEqual(paths[0], paths[1]);
      assert.deepEqual(JSON.parse(fs.readFileSync(paths[1], 'utf8')), second);
      for (const file of paths)
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);
      assert.equal(fs.statSync(path.dirname(paths[0])).mode & 0o777, 0o700);
    } finally {
      prepared.cleanup();
      for (const file of paths) assert.equal(fs.existsSync(file), false);
      fs.rmSync(workingDir, { force: true, recursive: true });
    }
  });
}

test('runs a Bunker-style suite with separate authenticated browser contexts', async () => {
  const { spawnSync } = await import('node:child_process');
  const workingDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'playrunner-two-sites-'),
  );
  fs.symlinkSync(
    path.resolve('node_modules'),
    path.join(workingDir, 'node_modules'),
    'dir',
  );
  fs.writeFileSync(
    path.join(workingDir, 'sessions.spec.ts'),
    `
import { test, expect } from '@playwright/test';
test('default and explicit sessions remain isolated', async ({ browser, context }) => {
  expect((await context.storageState()).origins[0].origin).toBe('https://bunker.test');
  for (const [variable, site] of [['E2E_REGRESSION_STORAGE_STATE', 'bunker'], ['E2E_STEADFAST_STORAGE_STATE', 'steadfast']]) {
    const isolated = await browser.newContext({ storageState: process.env[variable] });
    try {
      await isolated.route('**/*', route => route.fulfill({ body: '<html>App</html>', contentType: 'text/html' }));
      const page = await isolated.newPage();
      await page.goto('https://' + site + '.test');
      expect(await page.evaluate(() => localStorage.getItem('session'))).toBe(site + '-session');
      const otherSite = site === 'bunker' ? 'steadfast' : 'bunker';
      await page.goto('https://' + otherSite + '.test');
      expect(await page.evaluate(() => localStorage.getItem('session'))).toBeNull();
    } finally { await isolated.close(); }
  }
});
`,
  );
  const prepared = prepareAuthenticationState({
    runtime: 'typescript',
    workingDir,
    state: {
      profiles: [
        {
          profileId: 'bunker',
          environmentVariable: 'E2E_REGRESSION_STORAGE_STATE',
          state: {
            cookies: [],
            origins: [
              {
                origin: 'https://bunker.test',
                localStorage: [{ name: 'session', value: 'bunker-session' }],
              },
            ],
          },
        },
        {
          profileId: 'steadfast',
          environmentVariable: 'E2E_STEADFAST_STORAGE_STATE',
          state: {
            cookies: [],
            origins: [
              {
                origin: 'https://steadfast.test',
                localStorage: [{ name: 'session', value: 'steadfast-session' }],
              },
            ],
          },
        },
      ],
    },
  });
  try {
    const result = spawnSync(
      process.execPath,
      [
        require.resolve('@playwright/test/cli'),
        'test',
        '--config',
        prepared.configPath!,
        '--workers=1',
        '--reporter=line',
      ],
      {
        cwd: workingDir,
        env: { ...process.env, ...prepared.environment },
        encoding: 'utf8',
        timeout: 60_000,
      },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    prepared.cleanup();
    fs.rmSync(workingDir, { force: true, recursive: true });
  }
});
