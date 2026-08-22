import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createGitCredentialEnvironment,
  normalizeGitHubRepository,
  resolveRepositoryWorkingDirectory,
} from './repository';

test('keeps GitHub credentials out of the repository URL and process argv', () => {
  const environment = createGitCredentialEnvironment('github-secret', {
    SAFE: 'value',
  });
  assert.equal(environment.SAFE, 'value');
  assert.equal(environment.GIT_TERMINAL_PROMPT, '0');
  assert.match(environment.GIT_CONFIG_VALUE_0 || '', /^Authorization: Basic /);
  assert.doesNotMatch(
    `https://github.com/${normalizeGitHubRepository('owner/repo')}.git`,
    /github-secret/,
  );
});

test('rejects malformed GitHub repository identifiers', () => {
  assert.throws(() => normalizeGitHubRepository('github.com/owner/repo'));
  assert.throws(() => normalizeGitHubRepository('owner/repo/extra'));
});

test('rejects a configured folder that escapes through a symlink', () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'playrunner-playwright-repository-'),
  );
  const repositoryRoot = path.join(temporaryRoot, 'repo');
  const outsideRoot = path.join(temporaryRoot, 'outside');
  fs.mkdirSync(repositoryRoot);
  fs.mkdirSync(outsideRoot);
  fs.symlinkSync(outsideRoot, path.join(repositoryRoot, 'escape'));
  try {
    assert.throws(
      () => resolveRepositoryWorkingDirectory(repositoryRoot, 'escape'),
      /inside the repository/,
    );
  } finally {
    fs.rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
