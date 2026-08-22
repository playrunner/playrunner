import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boundInlineAgentResult,
  createInlineAttemptHistory,
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
  const result = boundInlineAgentResult(
    {
      attemptHistory: [],
      attempts: 0,
      patch: '',
      patchBytes: 0,
      patchTruncated: false,
      repositoryStatus: '',
      runnerError: 'Agent failed to start.',
      status: 'failed',
      stopReason: 'runner_failed',
      validation: null,
    },
    null,
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.stopReason, 'runner_failed');
  assert.equal(result.validation, null);
  assert.equal(result.runnerError, 'Agent failed to start.');
});

test('truncates an inline patch on a UTF-8 byte boundary', () => {
  const patch = truncateInlinePatch('ééé', 5);
  assert.equal(patch, 'éé');
  assert.ok(Buffer.byteLength(patch, 'utf8') <= 5);
});
