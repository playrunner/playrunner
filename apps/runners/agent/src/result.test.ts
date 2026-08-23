import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authenticatedPlaywrightReportUrl,
  boundInlineAgentResult,
  createInlineFailure,
  createInlineAttemptHistory,
  createInlineValidatorResult,
  MAX_INLINE_RESULT_BYTES,
  truncateInlinePatch,
} from './result';
import type { SupervisorResult } from './supervisor';
import type { ValidationResult } from './validator';

function validation(): ValidationResult {
  return {
    artifacts: { traces: [], validationReport: 'validation/final.json' },
    attempt: 1,
    authoritative: true,
    completedAt: '2026-08-21T00:00:02.000Z',
    coverageEvidence: {
      detailed: true,
      fresh: true,
      provenance: 'repository_reported_untrusted',
      reviewRequired: true,
      sourcePath: 'coverage/coverage-final.json',
    },
    dimensions: {
      assertionQuality: { minimum: 100, observed: 100, passed: true },
      branchCoverage: { minimum: 70, observed: 80, passed: true },
      changedLineCoverage: {
        applicable: false,
        minimum: 80,
        observed: null,
        passed: true,
      },
      lineCoverage: { minimum: 80, observed: 90, passed: true },
      requirementCoverage: { minimum: 100, observed: 100, passed: true },
    },
    durationMs: 1,
    feedback: { items: [], summary: 'Validation passed.' },
    feedbackText: 'Validation passed.',
    passed: true,
    requirements: { covered: 0, items: [], total: 0 },
    schemaVersion: '1.0',
    startedAt: '2026-08-21T00:00:01.000Z',
    status: 'passed',
    testRun: {
      command: 'npm run test:coverage',
      durationMs: 1,
      exitCode: 0,
      failedTests: [],
      passed: true,
      stderrTail: '',
      stdoutTail: '',
      timedOut: false,
    },
    testSummary: {
      files: 1,
      focused: 0,
      skipped: 0,
      tests: 1,
      testsWithMeaningfulAssertions: 1,
    },
    violations: [],
  };
}

function supervisor(finalValidation = validation()): SupervisorResult {
  return {
    attemptHistory: [
      {
        agent: {
          completedAt: '2026-08-21T00:00:01.000Z',
          durationMs: 1,
          startedAt: '2026-08-21T00:00:00.000Z',
          status: 'completed',
        },
        attempt: 1,
        validation: finalValidation,
      },
    ],
    attempts: 1,
    completedAt: '2026-08-21T00:00:02.000Z',
    durationMs: 2,
    schemaVersion: '1.0',
    startedAt: '2026-08-21T00:00:00.000Z',
    status: 'passed',
    stopReason: 'passed',
    validation: finalValidation,
  };
}

test('summarizes attempt history without repeating validation reports', () => {
  const finalValidation = validation();
  finalValidation.feedbackText = 'x'.repeat(100_000);
  const history = createInlineAttemptHistory(supervisor(finalValidation));

  assert.equal(history[0].validation?.status, 'passed');
  assert.equal(history[0].validation?.report, 'validation/final.json');
  assert.equal('feedbackText' in history[0].validation!, false);
});

test('compacts an oversized final validation while preserving its structure', () => {
  const finalValidation = validation();
  finalValidation.feedbackText = 'x'.repeat(MAX_INLINE_RESULT_BYTES + 1);
  finalValidation.feedback.items.push({
    code: 'coverage',
    message: 'Coverage is below policy.',
    priority: 'high',
    remediation: 'Add coverage.',
  });
  finalValidation.violations.push({
    code: 'hardcoded_wait',
    file: 'tests/example.spec.ts',
    line: 10,
    message: 'Hard-coded wait found.',
    priority: 'high',
    remediation: 'Wait for an observable condition.',
    severity: 'error',
  });
  const result = boundInlineAgentResult(
    {
      repositoryStatus: '',
      validation: finalValidation,
    },
    finalValidation,
  );

  assert.equal(result.validationTruncated, true);
  assert.equal(
    (result.validation as Record<string, unknown>).authoritative,
    true,
  );
  assert.deepEqual(
    (result.validation as Record<string, unknown>).coverageEvidence,
    finalValidation.coverageEvidence,
  );
  const compacted = result.validation as Record<string, any>;
  assert.match(compacted.feedbackText, /^x+$/);
  assert.equal(compacted.feedbackTextTruncated, true);
  assert.equal(compacted.feedback.items[0].code, 'coverage');
  assert.equal(compacted.violations[0].code, 'hardcoded_wait');
  assert.equal(compacted.inlineTruncation.feedbackText, true);
  assert.ok(
    Buffer.byteLength(JSON.stringify(result), 'utf8') <=
      MAX_INLINE_RESULT_BYTES,
  );
});

test('leaves a normal validation contract intact when compaction is unnecessary', () => {
  const finalValidation = validation();
  const result = boundInlineAgentResult(
    { repositoryStatus: '', validation: finalValidation },
    finalValidation,
  );

  assert.equal(result.validation, finalValidation);
  assert.equal(result.validationTruncated, undefined);
  assert.equal(
    (result.validation as ValidationResult).feedbackText,
    'Validation passed.',
  );
  assert.deepEqual((result.validation as ValidationResult).violations, []);
});

test('preserves the failed-result contract without a validation report', () => {
  const failure = createInlineFailure(
    'agent_failed',
    'Codex sandbox failed to initialize.',
  );
  const result = boundInlineAgentResult(
    {
      attemptHistory: [],
      attempts: 0,
      failure,
      patch: '',
      patchBytes: 0,
      patchTruncated: false,
      repositoryStatus: '',
      runnerError: 'Codex sandbox failed to initialize.',
      status: 'failed',
      stopReason: 'agent_failed',
      validation: null,
    },
    null,
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.stopReason, 'agent_failed');
  assert.equal(result.validation, null);
  assert.equal(result.runnerError, 'Codex sandbox failed to initialize.');
  assert.deepEqual(result.failure, failure);
});

test('creates a bounded first-class failure and redacts credentials', () => {
  const credential = 'model-secret-value';
  const failure = createInlineFailure(
    'agent_failed',
    `Codex could not start with ${credential}`,
    [credential],
  );

  assert.equal(failure.kind, 'agent_failed');
  assert.match(failure.message, /blocked output/);
  assert.doesNotMatch(failure.message, new RegExp(credential));
});

test('creates a validator child result with final validation and published artifacts', () => {
  const finalValidation = validation();
  finalValidation.passed = false;
  finalValidation.status = 'failed';
  finalValidation.feedback.summary = 'Browser validation failed.';
  const artifacts = {
    artifactManifest: '/outputs/run/container/artifact-manifest.json',
    coverage: '/outputs/run/container/coverage/coverage-final.json',
    patch: '/outputs/run/container/workspace.patch',
    playwrightReport: '/outputs/run/container/playwright-report/index.html',
    repositoryStatus: '/outputs/run/container/repository-status.txt',
    traces: [],
    validationHistory: '/outputs/run/container/validation/history.json',
    validationReport: '/outputs/run/container/validation/final.json',
  };

  const output = createInlineValidatorResult(finalValidation, {
    artifacts,
    attempts: 3,
    stopReason: 'max_attempts',
  });

  assert.equal(output.status, 'failed');
  assert.equal(output.attempts, 3);
  assert.equal(output.stopReason, 'max_attempts');
  assert.equal(
    (output.failure as Record<string, unknown>).message,
    'Browser validation failed.',
  );
  assert.equal(output.validation, finalValidation);
  assert.deepEqual(output.artifacts, artifacts);
  assert.equal(
    output.reportUrl,
    '/outputs/run/container/playwright-report/index.html',
  );
  assert.equal(
    (output.artifacts as Record<string, unknown>).playwrightReport,
    '/outputs/run/container/playwright-report/index.html',
  );
});

test('only aliases protected same-origin Playwright report artifacts', () => {
  assert.equal(
    authenticatedPlaywrightReportUrl({
      artifactManifest: '/outputs/run/container/artifact-manifest.json',
      playwrightReport:
        '/outputs/run_1/container.2/playwright-report/index.html',
      traces: [],
      validationHistory: '/outputs/run/container/validation/history.json',
    }),
    '/outputs/run_1/container.2/playwright-report/index.html',
  );

  for (const playwrightReport of [
    'https://example.com/report.html',
    '//example.com/report.html',
    '/outputs/run/container/../playwright-report/index.html',
    '/outputs/run/container/playwright-report/index.html?token=secret',
    '/outputs/run/container/playwright-report/index.html#fragment',
    '/outputs/run/container/playwright-report/index.htm',
  ]) {
    assert.equal(
      authenticatedPlaywrightReportUrl({
        artifactManifest: '/outputs/run/container/artifact-manifest.json',
        playwrightReport,
        traces: [],
        validationHistory: '/outputs/run/container/validation/history.json',
      }),
      undefined,
      playwrightReport,
    );
  }
});

test('compacts oversized validator child results within the event budget', () => {
  const finalValidation = validation();
  finalValidation.feedbackText = 'x'.repeat(MAX_INLINE_RESULT_BYTES + 1);

  const output = createInlineValidatorResult(finalValidation);

  assert.equal(output.validationTruncated, true);
  assert.ok(
    Buffer.byteLength(JSON.stringify(output), 'utf8') <=
      MAX_INLINE_RESULT_BYTES,
  );
});

test('fails closed before publishing validator output containing a credential', () => {
  const credential = 'github-secret-value';
  const finalValidation = validation();
  finalValidation.feedback.summary = `Failure included ${credential}`;

  assert.throws(
    () =>
      createInlineValidatorResult(finalValidation, {
        prohibitedExactValues: [credential],
      }),
    /blocked output/,
  );
});

test('truncates an inline patch on a UTF-8 byte boundary', () => {
  const patch = truncateInlinePatch('ééé', 5);
  assert.equal(patch, 'éé');
  assert.ok(Buffer.byteLength(patch, 'utf8') <= 5);
});
