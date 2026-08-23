import {
  validatePlaywrightTests,
  type ValidationResult,
  type ValidatorConfig,
  type ValidatorOptions,
} from './validator';
import {
  runVitestCoverage,
  type VitestCoverageRunResult,
} from './vitest-validator';

const UNIT_OUTPUT_TAIL_BYTES = 2_000;

export type ValidationSuiteOptions = ValidatorOptions & {
  runUnitCoverage?: (
    cwd: string,
    timeoutMs: number,
  ) => Promise<VitestCoverageRunResult>;
  validateBrowser?: typeof validatePlaywrightTests;
};

function outputTail(value: string, maximumBytes = UNIT_OUTPUT_TAIL_BYTES) {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= maximumBytes) return value;
  let start = bytes.length - maximumBytes;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start += 1;
  return `[truncated]\n${bytes.subarray(start).toString('utf8')}`;
}

function unitFailureCode(result: VitestCoverageRunResult): string {
  if (result.failure === 'timeout') return 'unit_test_timeout';
  if (
    result.failure === 'coverage_missing' ||
    result.failure === 'invalid_coverage'
  ) {
    return 'unit_coverage_invalid';
  }
  return 'unit_test_failure';
}

function attachUnitResult(
  validation: ValidationResult,
  unit: VitestCoverageRunResult,
): ValidationResult {
  validation.unitTestRun = {
    args: unit.args,
    command: unit.command,
    coverageReport: unit.coverageReportPath,
    durationMs: unit.durationMs,
    exitCode: unit.code,
    failure: unit.failure,
    failureMessage: unit.failureMessage,
    lcovReport: unit.lcovReportPath,
    passed: unit.passed,
    stderrTail: outputTail(unit.stderr),
    stdoutTail: outputTail(unit.stdout),
    testCount: unit.testCount,
    testResults: unit.testResultsPath,
    timedOut: unit.timedOut,
  };
  validation.durationMs += unit.durationMs;
  validation.completedAt = new Date().toISOString();
  if (unit.passed) return validation;

  const code = unitFailureCode(unit);
  const output = outputTail(unit.stderr || unit.stdout);
  const message = unit.failureMessage || 'The independent Vitest run failed.';
  const remediation = [
    unit.failure === 'no_tests'
      ? 'Add focused *.unit.test.* or *.unit.spec.* tests for production logic and negative branches.'
      : 'Fix the unit tests or coverage instrumentation, then rerun playrunner-validator.',
    output ? `Recent output:\n${output}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  validation.violations.push({
    code,
    message,
    priority: 'critical',
    remediation,
    severity: 'error',
  });
  const previousTotal =
    validation.violationSummary?.total ?? validation.violations.length - 1;
  validation.violationSummary = {
    reported: validation.violations.length,
    total: previousTotal + 1,
    truncated: validation.violationSummary?.truncated === true,
  };
  const finding = {
    code,
    message,
    priority: 'critical' as const,
    remediation,
  };
  validation.feedback.items = [finding, ...validation.feedback.items].slice(
    0,
    100,
  );
  validation.feedback.reported = validation.feedback.items.length;
  validation.feedback.total =
    (validation.feedback.total ?? validation.feedback.items.length - 1) + 1;
  validation.feedback.truncated =
    validation.feedback.items.length < (validation.feedback.total || 0);
  validation.feedback.summary = `Validation failed because the independent Vitest unit-test layer did not pass${previousTotal ? `, with ${previousTotal} additional blocking finding${previousTotal === 1 ? '' : 's'}` : ''}.`;
  validation.feedbackText = [
    validation.feedback.summary,
    `[${code}] ${message}`,
    `Fix: ${remediation}`,
    validation.feedbackText === 'Validation passed.'
      ? ''
      : validation.feedbackText,
  ]
    .filter(Boolean)
    .join('\n');
  validation.passed = false;
  validation.status = 'failed';
  return validation;
}

/** Runs every enabled test layer. A pull request can pass only when all do. */
export async function validateTestSuite(
  cwd: string,
  config: ValidatorConfig,
  options: ValidationSuiteOptions = {},
): Promise<ValidationResult> {
  const startedAt = Date.now();
  const validation = await (options.validateBrowser ||
    validatePlaywrightTests)(cwd, config, options);
  if (config.runTests === false || config.unitCoverage !== true) {
    return validation;
  }

  const timeoutMs = Math.max(
    1,
    (options.timeoutMs ??
      Math.max(1, Number(config.validationTimeoutMinutes) || 30) * 60_000) -
      (Date.now() - startedAt),
  );
  const unit = await (options.runUnitCoverage ||
    ((root, timeout) => runVitestCoverage(root, { timeoutMs: timeout })))(
    cwd,
    timeoutMs,
  );
  return attachUnitResult(validation, unit);
}
