import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  detectProjectDependencySetup,
  prepareProjectDependencies,
} from './dependency-setup';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'playrunner-deps-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  return root;
}

test('detects the nearest reproducible package-manager install', () => {
  const root = fixture();
  const workspace = path.join(root, 'apps', 'web');
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
  try {
    assert.deepEqual(detectProjectDependencySetup(root, workspace), {
      args: ['ci', '--no-audit', '--no-fund'],
      command: 'npm',
      directory: fs.realpathSync(root),
      lockfile: 'package-lock.json',
      omittedExternalDevDependencies: false,
    });
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('requires one lockfile and rejects ambiguous package managers', () => {
  const root = fixture();
  try {
    assert.throws(
      () => detectProjectDependencySetup(root, root),
      /requires package-lock\.json/,
    );
    fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
    fs.writeFileSync(path.join(root, 'yarn.lock'), '');
    assert.throws(
      () => detectProjectDependencySetup(root, root),
      /multiple lockfiles/,
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('omits development dependencies whose local files are outside the clone', () => {
  const root = fixture();
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      devDependencies: { playrunner: 'file:../playrunner/packages/cli' },
    }),
  );
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
  try {
    const setup = detectProjectDependencySetup(root, root);
    assert.equal(setup.omittedExternalDevDependencies, true);
    assert.deepEqual(setup.args, [
      'ci',
      '--no-audit',
      '--no-fund',
      '--omit=dev',
    ]);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('installs as the agent identity without forwarding credentials', async () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
  try {
    let invocation:
      | {
          args: string[];
          command: string;
          options: NonNullable<
            Parameters<typeof import('./process').runProcess>[2]
          >;
        }
      | undefined;
    const setup = await prepareProjectDependencies({
      containerNodeModulesRoot: null,
      environment: { PATH: '/usr/bin', OPENAI_API_KEY: undefined },
      identity: { gid: 1001, home: '/home/playrunner', uid: 1001 },
      repositoryRoot: root,
      runCommand: async (command, args, options) => {
        invocation = { args, command, options };
        return {
          code: 0,
          durationMs: 1,
          signal: null,
          stderr: '',
          stdout: '',
          timedOut: false,
        };
      },
      workingDirectory: root,
    });

    assert.equal(setup.command, 'pnpm');
    assert.equal(invocation?.command, 'pnpm');
    assert.deepEqual(invocation?.args, ['install', '--frozen-lockfile']);
    assert.equal(invocation?.options.uid, 1001);
    assert.equal(invocation?.options.gid, 1001);
    assert.equal(
      (invocation?.options.env as NodeJS.ProcessEnv).OPENAI_API_KEY,
      undefined,
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('exposes the prebuilt test packages in the prepared project', async () => {
  const root = fixture();
  const containerModules = fs.mkdtempSync(
    path.join(os.tmpdir(), 'playrunner-container-modules-'),
  );
  fs.writeFileSync(
    path.join(root, 'package-lock.json'),
    JSON.stringify({
      lockfileVersion: 3,
      name: 'fixture',
      packages: { '': { name: 'fixture', version: '1.0.0' } },
      version: '1.0.0',
    }),
  );
  fs.mkdirSync(path.join(containerModules, '@playwright', 'test'), {
    recursive: true,
  });
  fs.mkdirSync(path.join(containerModules, '@bgotink', 'playwright-coverage'), {
    recursive: true,
  });
  fs.mkdirSync(path.join(containerModules, '@vitest', 'coverage-v8'), {
    recursive: true,
  });
  const packageFixture = (
    name: string,
    manifest: Record<string, unknown> = {},
  ) => {
    const directory = path.join(containerModules, ...name.split('/'));
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'package.json'),
      JSON.stringify({ name, version: '1.0.0', ...manifest }),
    );
    fs.writeFileSync(
      path.join(directory, 'index.js'),
      `module.exports = '${name}';\n`,
    );
  };
  packageFixture('@testing-library/dom');
  packageFixture('@testing-library/react', {
    dependencies: {
      '@testing-library/dom': '1.0.0',
      'runtime-helper': '1.0.0',
    },
    peerDependencies: { react: '>=18', 'react-dom': '>=18' },
  });
  packageFixture('@testing-library/user-event', {
    peerDependencies: { '@testing-library/dom': '>=1' },
  });
  packageFixture('runtime-helper');
  fs.mkdirSync(path.join(containerModules, 'jsdom'), { recursive: true });
  fs.mkdirSync(path.join(containerModules, 'playwright'), { recursive: true });
  fs.mkdirSync(path.join(containerModules, 'vitest'), { recursive: true });
  try {
    await prepareProjectDependencies({
      containerNodeModulesRoot: containerModules,
      environment: { PATH: process.env.PATH },
      identity: {
        gid: process.getgid?.() ?? 1001,
        home: os.homedir(),
        uid: process.getuid?.() ?? 1001,
      },
      repositoryRoot: root,
      workingDirectory: root,
    });
    assert.equal(
      fs.realpathSync(path.join(root, 'node_modules', '@playwright', 'test')),
      fs.realpathSync(path.join(containerModules, '@playwright', 'test')),
    );
    assert.equal(
      fs.realpathSync(
        path.join(root, 'node_modules', '@bgotink', 'playwright-coverage'),
      ),
      fs.realpathSync(
        path.join(containerModules, '@bgotink', 'playwright-coverage'),
      ),
    );
    assert.equal(
      fs.realpathSync(path.join(root, 'node_modules', 'playwright')),
      fs.realpathSync(path.join(containerModules, 'playwright')),
    );
    assert.equal(
      fs.realpathSync(
        path.join(root, 'node_modules', '@vitest', 'coverage-v8'),
      ),
      fs.realpathSync(path.join(containerModules, '@vitest', 'coverage-v8')),
    );
    for (const dependency of [
      ['@testing-library', 'dom'],
      ['@testing-library', 'react'],
      ['@testing-library', 'user-event'],
      ['runtime-helper'],
    ]) {
      const target = path.join(root, 'node_modules', ...dependency);
      assert.equal(fs.lstatSync(target).isSymbolicLink(), false);
      assert.equal(
        fs.readFileSync(path.join(target, 'index.js'), 'utf8'),
        `module.exports = '${dependency.join('/')}';\n`,
      );
    }
    assert.equal(
      fs.lstatSync(path.join(root, 'node_modules', 'jsdom')).isSymbolicLink(),
      true,
    );
    assert.equal(
      fs.realpathSync(path.join(root, 'node_modules', 'vitest')),
      fs.realpathSync(path.join(containerModules, 'vitest')),
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
    fs.rmSync(containerModules, { force: true, recursive: true });
  }
});
