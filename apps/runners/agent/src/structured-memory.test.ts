import assert from 'node:assert/strict';
import test from 'node:test';
import type { PreparedRepository } from './repository';
import {
  createStructuredMemory,
  type TerminalFailureKind,
} from './structured-memory';
import type { SupervisorResult } from './supervisor';

function prepared(): PreparedRepository {
  return {
    changeContext: {
      baseRef: 'main',
      baseSha: 'a'.repeat(40),
      eventType: 'push',
      headRef: 'feature/widget',
      headSha: 'b'.repeat(40),
      repository: 'playrunner/example',
    },
    headRevision: 'b'.repeat(40),
    repositoryRoot: '/workspace/repo',
    workingDirectory: '/workspace/repo',
  };
}

function supervisor(
  status: 'failed' | 'passed' = 'passed',
  summary = `Validation ${status}.`,
): SupervisorResult {
  return {
    attemptHistory: [],
    attempts: 1,
    completedAt: '2026-08-21T00:00:01.000Z',
    durationMs: 1,
    schemaVersion: '1.0',
    startedAt: '2026-08-21T00:00:00.000Z',
    status,
    stopReason: status === 'passed' ? 'passed' : 'max_attempts',
    validation: {
      feedback: { summary },
    } as SupervisorResult['validation'],
  };
}

test('records the effective passed terminal status', () => {
  const memory = createStructuredMemory({
    effectiveStatus: 'passed',
    prepared: prepared(),
    supervisor: supervisor(),
  });

  assert.equal(memory?.validation.status, 'passed');
  assert.equal(memory?.validation.summary, 'Validation passed.');
});

test('records artifact, repository, and delivery failures after validation passed', () => {
  const expected: Record<TerminalFailureKind, RegExp> = {
    artifact: /Artifact publication failed.*artifact storage/,
    delivery:
      /Bot PR delivery failed.*source-repository GitHub App permissions/,
    repository: /Repository inspection failed.*Git can read/,
  };

  for (const terminalFailureKind of Object.keys(
    expected,
  ) as TerminalFailureKind[]) {
    const memory = createStructuredMemory({
      effectiveStatus: 'failed',
      prepared: prepared(),
      supervisor: supervisor('passed'),
      terminalFailureKind,
    });

    assert.equal(memory?.validation.status, 'failed', terminalFailureKind);
    assert.match(
      memory?.validation.summary || '',
      expected[terminalFailureKind],
      terminalFailureKind,
    );
    assert.equal(
      Buffer.byteLength(memory?.validation.summary || '', 'utf8') <= 4_096,
      true,
      terminalFailureKind,
    );
  }
});

test('bounds the structured validation summary on a UTF-8 boundary', () => {
  const memory = createStructuredMemory({
    effectiveStatus: 'failed',
    prepared: prepared(),
    supervisor: supervisor('failed', '🧪'.repeat(5_000)),
  });

  assert.equal(memory?.validation.status, 'failed');
  assert.equal(
    Buffer.byteLength(memory?.validation.summary || '', 'utf8') <= 4_096,
    true,
  );
  assert.doesNotMatch(memory?.validation.summary || '', /\uFFFD/);
});
