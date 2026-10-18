import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRegressionSourceRevision } from './regression-source';

const request = {
  version: 1,
  mode: 'affected',
  sources: [
    {
      repository: 'example/app',
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
    },
  ],
};
test('pins the matching test repository to the regression head', () => {
  assert.equal(
    resolveRegressionSourceRevision(
      { action: 'clone', repository: 'example/app' },
      request,
    ),
    'b'.repeat(40),
  );
  assert.equal(
    resolveRegressionSourceRevision(
      { action: 'clone', repository: 'example/tests' },
      request,
    ),
    undefined,
  );
  assert.equal(
    resolveRegressionSourceRevision({ action: 'workspace' }, request),
    undefined,
  );
});
test('does not replace a conflicting release test-repository pin', () => {
  assert.throws(
    () =>
      resolveRegressionSourceRevision(
        { repository: 'example/app' },
        request,
        'c'.repeat(40),
      ),
    /conflicts/,
  );
  assert.equal(
    resolveRegressionSourceRevision(
      { repository: 'example/app' },
      request,
      'b'.repeat(40),
    ),
    'b'.repeat(40),
  );
});

test('normalizes the existing owner/repository.git syntax and pins unchanged policy revisions', () => {
  assert.equal(
    resolveRegressionSourceRevision({ repository: 'example/app.git' }, request),
    'b'.repeat(40),
  );
  assert.equal(
    resolveRegressionSourceRevision(
      {
        repository: 'example/tests.git',
        regression: {
          version: 1,
          repositories: [
            { repository: 'example/tests', revision: 'c'.repeat(40) },
          ],
          dependencies: [],
          journeys: [],
        },
      },
      request,
    ),
    'c'.repeat(40),
  );
});
