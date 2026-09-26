import assert from 'node:assert/strict';
import test from 'node:test';
import ProgressReporter from './progress-reporter';
import {
  readTestProgress,
  type TestProgress,
} from '../../shared/test-progress';
import type { TestCase, TestResult, Suite } from '@playwright/test/reporter';

test('counts final results once across retries, expected failures and skips', () => {
  const snapshots: TestProgress[] = [];
  const reporter = new ProgressReporter({
    emit: (value) => snapshots.push(value),
  });
  const a = { id: 'a', expectedStatus: 'passed', retries: 1 } as TestCase;
  const b = { id: 'b', expectedStatus: 'failed', retries: 0 } as TestCase;
  const c = { id: 'c', expectedStatus: 'passed', retries: 0 } as TestCase;
  reporter.onBegin({}, { allTests: () => [a, b, c] } as Suite);
  reporter.onTestBegin(a);
  reporter.onTestEnd(a, { status: 'failed', retry: 0 } as TestResult);
  assert.equal(snapshots.at(-1)!.completed, 0);
  reporter.onTestBegin(a);
  reporter.onTestEnd(a, { status: 'passed', retry: 1 } as TestResult);
  reporter.onTestBegin(b);
  reporter.onTestEnd(b, { status: 'failed', retry: 0 } as TestResult);
  reporter.onTestEnd(c, { status: 'skipped', retry: 0 } as TestResult);
  reporter.onEnd();
  assert.deepEqual(snapshots.at(-1), {
    total: 3,
    completed: 3,
    running: 0,
    passed: 2,
    failed: 0,
    skipped: 1,
  });
});

test('interrupted runs retain unfinished tests and reject impossible telemetry', () => {
  let snapshot: TestProgress;
  const reporter = new ProgressReporter({
    emit: (value) => {
      snapshot = value;
    },
  });
  const a = { id: 'a', expectedStatus: 'passed', retries: 0 } as TestCase;
  reporter.onBegin({}, { allTests: () => [a, a] } as Suite);
  reporter.onTestBegin(a);
  reporter.onTestEnd(a, { status: 'interrupted', retry: 0 } as TestResult);
  reporter.onEnd();
  assert.equal(snapshot!.completed, 1);
  assert.equal(snapshot!.failed, 1);
  assert.equal(readTestProgress({ ...snapshot!, total: 0 }), null);
  assert.equal(readTestProgress({ ...snapshot!, running: 100 }), null);
  assert.equal(readTestProgress({ ...snapshot!, passed: -1 }), null);
  assert.deepEqual(
    readTestProgress({ ...snapshot!, secret: 'omit' }),
    snapshot!,
  );
});
