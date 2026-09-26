import fs from 'node:fs';
import type {
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import type { TestProgress } from '../../shared/test-progress';

// Dedicated child-process pipe: never infer test results from console output.
export default class ProgressReporter implements Reporter {
  private total = 0;
  private completed = new Map<string, 'passed' | 'failed' | 'skipped'>();
  private running = new Set<string>();
  constructor(
    private options: { emit?: (progress: TestProgress) => void } = {},
  ) {}
  onBegin(_config: unknown, suite: Suite) {
    this.total = suite.allTests().length;
    this.publish();
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
    this.publish();
  }
  onEnd() {
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
