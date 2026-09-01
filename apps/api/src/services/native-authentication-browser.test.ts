import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  createNativeBrowserProfile,
  nativeBrowserArguments,
  nativeBrowserExecutableCandidates,
  removeNativeBrowserProfile,
} from './native-authentication-browser';

test('native authentication starts an isolated browser without automation control', () => {
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

test('native authentication profiles restore the last session and are removable', () => {
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

test('an explicitly configured browser executable is the only candidate', () => {
  assert.deepEqual(
    nativeBrowserExecutableCandidates(
      {
        PLAYRUNNER_AUTHENTICATION_BROWSER_EXECUTABLE_PATH:
          '/opt/browser/chrome',
      },
      'linux',
    ),
    ['/opt/browser/chrome'],
  );
});
