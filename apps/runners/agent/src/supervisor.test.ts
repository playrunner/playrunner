import assert from 'node:assert/strict';
import test from 'node:test';
import { buildValidatorFeedbackPrompt, runSupervisor } from './supervisor';
import type { ValidationResult } from './validator';

function validation(passed: boolean, attempt = 1): ValidationResult {
  return {
    artifacts: { traces: [] },
    attempt,
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
      assertionQuality: { minimum: 100, observed: passed ? 100 : 50, passed },
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
    feedback: {
      items: passed
        ? []
        : [
            {
              code: 'assertion_quality',
              location: 'tests/example.spec.ts:4:3',
              message: 'Assertion quality is 50%; required minimum is 100%.',
              priority: 'high',
              remediation: 'Add an observable assertion.',
            },
          ],
      summary: passed ? 'Validation passed.' : 'Validation failed.',
    },
    feedbackText: passed
      ? 'Validation passed.'
      : 'Validation failed with an assertion_quality finding.',
    passed,
    requirements: { covered: 0, items: [], total: 0 },
    schemaVersion: '1.0',
    startedAt: '2026-08-21T00:00:01.000Z',
    status: passed ? 'passed' : 'failed',
    testRun: {
      command: 'npx playwright test',
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
      testsWithMeaningfulAssertions: passed ? 1 : 0,
    },
    violations: [],
  };
}

test('feeds structured feedback back into the exact Codex session', async () => {
  const calls: Array<{
    prompt: string;
    resumeSessionId?: string;
  }> = [];
  let validations = 0;
  const result = await runSupervisor({
    initialPrompt: 'Initial task',
    maximumAttempts: 3,
    maximumDurationMs: 60_000,
    runAgent: async (request) => {
      calls.push({
        prompt: request.prompt,
        resumeSessionId: request.resumeSessionId,
      });
      return { sessionId: 'thread-123' };
    },
    validate: async ({ attempt }) => {
      validations += 1;
      return validation(attempt === 2, attempt);
    },
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.stopReason, 'passed');
  assert.equal(result.attempts, 2);
  assert.equal(validations, 2);
  assert.equal(calls[0].resumeSessionId, undefined);
  assert.equal(calls[1].resumeSessionId, 'thread-123');
  assert.match(calls[1].prompt, /assertion_quality/);
  assert.match(calls[1].prompt, /tests\/example\.spec\.ts:4:3/);
  assert.equal(result.attemptHistory.length, 2);
});

test('stops with the final validation after exhausting attempts', async () => {
  const result = await runSupervisor({
    initialPrompt: 'Initial task',
    maximumAttempts: 2,
    maximumDurationMs: 60_000,
    runAgent: async () => ({ sessionId: 'thread-123' }),
    validate: async ({ attempt }) => validation(false, attempt),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.stopReason, 'max_attempts');
  assert.equal(result.attempts, 2);
  assert.equal(result.validation?.attempt, 2);
});

test('records an agent failure and does not run validation', async () => {
  let validated = false;
  const result = await runSupervisor({
    initialPrompt: 'Initial task',
    maximumAttempts: 3,
    maximumDurationMs: 60_000,
    runAgent: async () => {
      throw new Error('agent unavailable');
    },
    validate: async () => {
      validated = true;
      return validation(true);
    },
  });

  assert.equal(validated, false);
  assert.equal(result.stopReason, 'agent_failed');
  assert.equal(result.attemptHistory[0].agent.status, 'failed');
  assert.match(result.error || '', /agent unavailable/);
});

test('rejects an ambiguous missing thread ID', async () => {
  const result = await runSupervisor({
    initialPrompt: 'Initial task',
    maximumAttempts: 3,
    maximumDurationMs: 60_000,
    runAgent: async () => ({}),
    validate: async () => validation(true),
  });

  assert.equal(result.stopReason, 'agent_failed');
  assert.match(result.error || '', /thread ID/);
});

test('includes dimensions, requirements, and artifacts in feedback', () => {
  const result = validation(false);
  result.artifacts.coverage = 'coverage/coverage-summary.json';
  result.requirements.items.push({
    critical: true,
    description: 'Checkout works',
    evidence: [],
    id: 'REQ-1',
    passed: false,
  });
  const prompt = buildValidatorFeedbackPrompt(result);

  assert.match(prompt, /coverage\/coverage-summary\.json/);
  assert.match(prompt, /repository_reported_untrusted/);
  assert.match(prompt, /REQ-1/);
  assert.match(prompt, /Do not weaken, disable, or bypass/);
});
