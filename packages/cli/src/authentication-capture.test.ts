import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  captureAndCloseRestoredBrowserStorage,
  captureRestoredBrowserStorage,
  createNativeBrowserProfile,
  nativeBrowserArguments,
  nativeBrowserExecutableCandidates,
  removeNativeBrowserProfile,
  testAuthenticationState,
} from './authentication-capture.js';

const packageDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

test('native capture launches an isolated browser without automation control', () => {
  const args = nativeBrowserArguments({
    profileDirectory: '/tmp/native-profile',
    startUrl: 'https://example.test/login',
  });
  assert.ok(args.includes('--user-data-dir=/tmp/native-profile'));
  assert.ok(args.includes('https://example.test/login'));
  assert.equal(
    args.some((argument) =>
      /automation|debugging|devtools|remote-debugging|test-type/i.test(
        argument,
      ),
    ),
    false,
  );
});

test('stored-session tests reject malformed state before launching Chrome', async () => {
  await assert.rejects(
    testAuthenticationState({
      startUrl: 'https://example.test',
      state: { cookies: [] },
      successCondition: { type: 'url_prefix', value: 'https://example.test' },
    }),
    /test state is invalid/,
  );
});

test('native capture profiles restore the last session and are removable', () => {
  const directory = createNativeBrowserProfile();
  try {
    const preferences = JSON.parse(
      fs.readFileSync(path.join(directory, 'Default', 'Preferences'), 'utf8'),
    );
    assert.equal(preferences.session.restore_on_startup, 1);
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  } finally {
    removeNativeBrowserProfile(directory);
  }
  assert.equal(fs.existsSync(directory), false);
});

test('configured browser executable is the only candidate', () => {
  assert.deepEqual(
    nativeBrowserExecutableCandidates(
      { PLAYRUNNER_AUTHENTICATION_BROWSER_EXECUTABLE_PATH: '/opt/chrome' },
      'linux',
    ),
    ['/opt/chrome'],
  );
});

test('cloud capture browser shutdown keeps the CLI process alive', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      `
        import { waitForNativeBrowserClosePoll } from './src/authentication-capture.ts';
        await waitForNativeBrowserClosePoll(20, true);
        process.stdout.write('completed');
      `,
    ],
    { cwd: packageDirectory, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'completed');
  assert.doesNotMatch(result.stderr, /unsettled top-level await/i);
});

test('storage capture retries after Chrome finishes restoring its session', async () => {
  const calls: string[] = [];
  const expected = { cookies: [], origins: [] };
  const page = {
    evaluate: async () => {
      calls.push('evaluate');
      return 'complete';
    },
    waitForLoadState: async () => {
      calls.push('load');
    },
    waitForTimeout: async () => {
      calls.push('retry-wait');
    },
  } as unknown as import('playwright').Page;
  let attempts = 0;
  const context = {
    storageState: async () => {
      calls.push('storage');
      attempts += 1;
      if (attempts === 1) {
        throw new Error(
          'Protocol error (Target.createTarget): Failed to open a new tab',
        );
      }
      return expected;
    },
  } as unknown as import('playwright').BrowserContext;

  assert.equal(await captureRestoredBrowserStorage(context, page), expected);
  assert.deepEqual(calls, [
    'load',
    'evaluate',
    'storage',
    'retry-wait',
    'load',
    'evaluate',
    'storage',
  ]);
});

test('storage capture settles before its browser context is closed', async () => {
  const calls: string[] = [];
  let finishStorage: (() => void) | undefined;
  const storageFinished = new Promise<void>((resolve) => {
    finishStorage = resolve;
  });
  const page = {
    evaluate: async () => {
      calls.push('evaluate');
      return 'complete';
    },
    waitForLoadState: async () => {
      calls.push('load');
    },
  } as unknown as import('playwright').Page;
  const expected = { cookies: [], origins: [] };
  const context = {
    close: async () => {
      calls.push('close');
    },
    storageState: async () => {
      calls.push('storage-start');
      await storageFinished;
      calls.push('storage-finish');
      return expected;
    },
  } as unknown as import('playwright').BrowserContext;

  const capture = captureAndCloseRestoredBrowserStorage(context, page);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['load', 'evaluate', 'storage-start']);

  finishStorage?.();
  assert.equal(await capture, expected);
  assert.deepEqual(calls, [
    'load',
    'evaluate',
    'storage-start',
    'storage-finish',
    'close',
  ]);
});
