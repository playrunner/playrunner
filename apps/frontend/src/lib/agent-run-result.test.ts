import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeAgentRunResult } from './agent-run-result';

test('summarizes validation dimensions, unit evidence, and authenticated artifacts', () => {
  const summary = summarizeAgentRunResult({
    artifacts: {
      artifactManifest: '/outputs/execution/container/artifact-manifest.json',
      browserCoverage:
        '/outputs/execution/container/coverage/coverage-final.json',
      patch: '/outputs/execution/container/workspace.patch',
      testResults: '/outputs/execution/container/test-results',
      traces: ['/outputs/execution/container/test-results/journey/trace.zip'],
      unsafe: 'https://untrusted.example/report',
      validationReport: '/outputs/execution/container/validation/final.json',
      vitestResults:
        '/outputs/execution/container/test-results/vitest-results.json',
    },
    attempts: 3,
    status: 'failed',
    stopReason: 'max_attempts',
    validation: {
      artifacts: {
        validationReport: '/outputs/execution/container/validation/final.json',
      },
      dimensions: {
        changedLineCoverage: {
          applicable: false,
          minimum: 80,
          observed: null,
          passed: true,
        },
        lineCoverage: { minimum: 80, observed: 72.5, passed: false },
      },
      feedbackText: 'Cover the untested profile error path.',
      status: 'failed',
      unitTestRun: {
        analyzedTests: 9,
        branchCoverage: 84,
        failure: null,
        lineCoverage: 100,
        passed: true,
        testCount: 9,
        testsWithMeaningfulAssertions: 9,
      },
    },
  });

  assert.equal(summary.available, true);
  assert.equal(summary.status, 'failed');
  assert.equal(summary.validationStatus, 'failed');
  assert.equal(summary.attempts, 3);
  assert.equal(summary.failure, 'Cover the untested profile error path.');
  assert.deepEqual(summary.dimensions, [
    {
      applicable: false,
      key: 'changedLineCoverage',
      label: 'Changed-line coverage',
      minimum: 80,
      observed: null,
      passed: true,
    },
    {
      applicable: true,
      key: 'lineCoverage',
      label: 'Line coverage',
      minimum: 80,
      observed: 72.5,
      passed: false,
    },
  ]);
  assert.equal(summary.unitRun?.testCount, 9);
  assert.equal(summary.unitRun?.testsWithMeaningfulAssertions, 9);
  assert.deepEqual(summary.artifacts, [
    {
      label: 'Artifact manifest',
      path: '/outputs/execution/container/artifact-manifest.json',
    },
    {
      label: 'Browser coverage',
      path: '/outputs/execution/container/coverage/coverage-final.json',
    },
    {
      label: 'Generated patch',
      path: '/outputs/execution/container/workspace.patch',
    },
    {
      label: 'Playwright trace 1',
      path: '/outputs/execution/container/test-results/journey/trace.zip',
    },
    {
      label: 'Validation report',
      path: '/outputs/execution/container/validation/final.json',
    },
    {
      label: 'Vitest results',
      path: '/outputs/execution/container/test-results/vitest-results.json',
    },
  ]);
});

test('surfaces the latest agent failure when validation never ran', () => {
  const summary = summarizeAgentRunResult({
    attemptHistory: [
      { agent: { status: 'completed' }, attempt: 1 },
      {
        agent: {
          error: 'Codex could not authenticate with the configured model.',
          status: 'failed',
        },
        attempt: 2,
      },
    ],
    attempts: 2,
    status: 'failed',
    stopReason: 'agent_failed',
    validation: null,
  });

  assert.equal(
    summary.failure,
    'Codex could not authenticate with the configured model.',
  );
  assert.equal(summary.validationStatus, 'unknown');
  assert.deepEqual(summary.dimensions, []);
  assert.equal(summary.unitRun, null);
});

test('prefers the first-class bounded failure message', () => {
  const summary = summarizeAgentRunResult({
    attemptHistory: [{ agent: { error: 'Nested fallback.' }, attempt: 1 }],
    failure: {
      kind: 'agent',
      message: 'Codex has no API credits remaining.',
    },
    status: 'failed',
  });

  assert.equal(summary.failure, 'Codex has no API credits remaining.');
});

test('returns an unavailable summary without a latest node output', () => {
  const summary = summarizeAgentRunResult(undefined);

  assert.equal(summary.available, false);
  assert.equal(summary.status, 'unknown');
  assert.deepEqual(summary.artifacts, []);
});
