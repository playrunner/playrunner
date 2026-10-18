import fs from 'node:fs';
import path from 'node:path';
import type {
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import {
  readTestResultEvent,
  type TestProgress,
  type TestResultEvent,
} from '../../shared/test-progress';

// Dedicated child-process pipe: never infer test results from console output.
export default class ProgressReporter implements Reporter {
  private total = 0;
  private completed = new Map<string, 'passed' | 'failed' | 'skipped'>();
  private running = new Set<string>();
  private heartbeat?: ReturnType<typeof setInterval>;
  constructor(
    private options: {
      emit?: (progress: TestProgress) => void;
      emitResult?: (result: TestResultEvent) => void;
    } = {},
  ) {}
  onBegin(_config: unknown, suite: Suite) {
    this.total = suite.allTests().length;
    this.publish();
    // A quiet, long test is still alive. Publish through the same runner pipe,
    // without inventing completed tests or relying on customer console output.
    this.heartbeat = setInterval(() => this.publish(), 15000);
    this.heartbeat.unref();
  }
  onTestBegin(test: TestCase) {
    this.completed.delete(test.id);
    this.running.add(test.id);
    this.publish();
  }
  onTestEnd(test: TestCase, result: TestResult) {
    this.running.delete(test.id);
    const expected = result.status === test.expectedStatus;
    if (result.status === 'skipped') this.completed.set(test.id, 'skipped');
    else if (expected) this.completed.set(test.id, 'passed');
    else if (result.retry >= test.retries)
      this.completed.set(test.id, 'failed');
    if (
      expected ||
      result.status === 'skipped' ||
      result.status === 'interrupted' ||
      result.retry >= test.retries
    ) {
      const parents: string[] = [];
      let parent = test.parent;
      while (parent) {
        if (parent.type === 'describe') parents.unshift(parent.title);
        parent = parent.parent;
      }
      const outcome = readTestResultEvent({
        evidenceId: test.id,
        title: [...parents, test.title].join(' › ').slice(0, 2000),
        project: test.parent?.project()?.name || '',
        file: test.location?.file
          ? path
              .relative(process.cwd(), test.location.file)
              .split(path.sep)
              .join('/')
          : '',
        status:
          result.status === 'skipped'
            ? 'skipped'
            : expected
              ? 'passed'
              : result.status === 'interrupted'
                ? 'blocked'
                : 'failed',
        retry: result.retry,
        duration: result.duration || 0,
        ...(expected && result.status === 'failed'
          ? { expectedFailure: true as const }
          : {}),
      });
      if (outcome) {
        if (this.options.emitResult) this.options.emitResult(outcome);
        else if (!this.options.emit)
          fs.writeSync(
            3,
            JSON.stringify({ type: 'test_result', test: outcome }) + '\n',
          );
      }
    }
    this.publish();
  }
  onEnd() {
    clearInterval(this.heartbeat);
    this.publish();
  }
  private publish() {
    const statuses = [...this.completed.values()];
    const progress: TestProgress = {
      total: this.total,
      completed: statuses.length,
      running: this.running.size,
      passed: statuses.filter((status) => status === 'passed').length,
      failed: statuses.filter((status) => status === 'failed').length,
      skipped: statuses.filter((status) => status === 'skipped').length,
    };
    if (this.options.emit) this.options.emit(progress);
    else fs.writeSync(3, JSON.stringify(progress) + '\n');
  }
}
