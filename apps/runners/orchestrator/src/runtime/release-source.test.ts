import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveReleaseSourceRevision } from './release-source';

const revision = 'a'.repeat(40);
const config = {
  action: 'clone',
  repository: 'example/tests',
  branch: revision,
};

test('release repository discovery and shards use the pinned test commit', () => {
  assert.equal(resolveReleaseSourceRevision(config, true), revision);
  assert.equal(resolveReleaseSourceRevision(config, true, revision), revision);
  assert.equal(
    resolveReleaseSourceRevision(
      { ...config, branch: revision.toUpperCase() },
      true,
      revision,
    ),
    revision,
  );
  assert.throws(
    () => resolveReleaseSourceRevision(config, true, 'b'.repeat(40)),
    /does not match/,
  );
  assert.throws(
    () => resolveReleaseSourceRevision({ ...config, branch: 'main' }, true),
    /full pinned/,
  );
  assert.throws(
    () => resolveReleaseSourceRevision({ repository: 'example/tests' }, true),
    /full pinned/,
  );
});

test('ordinary workflows and immutable non-repository sources retain existing behavior', () => {
  assert.equal(
    resolveReleaseSourceRevision({ ...config, branch: 'main' }, false),
    undefined,
  );
  assert.equal(
    resolveReleaseSourceRevision(config, false, 'discovered-revision'),
    'discovered-revision',
  );
  assert.equal(
    resolveReleaseSourceRevision({ action: 'run', testScript: 'test' }, true),
    undefined,
  );
  assert.equal(
    resolveReleaseSourceRevision(
      { action: 'upload', testSuite: { id: 'suite' } },
      true,
    ),
    undefined,
  );
});
