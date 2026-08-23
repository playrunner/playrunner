import { createCredentialFreeEnvironment } from './codex-auth';
import {
  analyzeExplicitUnitTests,
  validatePlaywrightTests,
  type ExplicitUnitTestAnalysis,
  type ValidationResult,
  type ValidationViolation,
  type ValidatorConfig,
  type ValidatorOptions,
} from './validator';
import {
  runVitestCoverage,
  type VitestCoverageRunResult,
} from './vitest-validator';

const UNIT_OUTPUT_TAIL_BYTES = 2_000;
const MAX_FEEDBACK_ITEMS = 100;
const MAX_FEEDBACK_TEXT_BYTES = 64 * 1024;
const MAX_VIOLATIONS = 1_000;
const UNIT_QUALITY_BLOCKING_CODES = new Set([
  'analysis_incomplete',
  'coverage_artifact_synthesis',
  'expected_failure_test',
  'focused_test',
  'hardcoded_wait',
  'retry_dependence',
  'skipped_test',
  'trivial_assertion',
  'unresolved_test_body',
  'zero_assertion_test',
]);

export type ValidationSuiteOptions = ValidatorOptions & {
  analyzeUnitTests?: (cwd: string) => ExplicitUnitTestAnalysis;
  runUnitCoverage?: (
    cwd: string,
    timeoutMs: number,
    minimum: { branchCoverage: number; lineCoverage: number },
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

function truncateStart(value: string, maximumBytes: number) {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= maximumBytes) return value;
  const marker = Buffer.from('\n[truncated]', 'utf8');
  let end = Math.max(0, maximumBytes - marker.length);
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return `${bytes.subarray(0, end).toString('utf8')}${marker.toString('utf8')}`;
}

function unitFailureCode(result: VitestCoverageRunResult): string {
  if (result.failure === 'timeout') return 'unit_test_timeout';
  if (
    result.failure === 'coverage_missing' ||
    result.failure === 'invalid_coverage' ||
    result.failure === 'line_coverage' ||
    result.failure === 'branch_coverage'
  ) {
    return 'unit_coverage_invalid';
  }
  return 'unit_test_failure';
}

function unitQualityViolations(
  before: ExplicitUnitTestAnalysis,
  after: ExplicitUnitTestAnalysis,
  unit: VitestCoverageRunResult,
): ValidationViolation[] {
  const violations = after.violations.filter((violation) =>
    UNIT_QUALITY_BLOCKING_CODES.has(violation.code),
  );
  const sourceStable =
    before.fingerprint === after.fingerprint &&
    before.fileCount === after.fileCount;
  if (!sourceStable) {
    violations.unshift({
      code: 'unit_test_source_changed',
      message:
        'The explicit unit-test sources changed while the authoritative Vitest run was executing.',
      priority: 'critical',
      remediation:
        'Remove test-source mutation and rerun validation against a stable repository workspace.',
      severity: 'error',
    });
  }
  if (after.testCount === 0) {
    violations.push({
      code: 'unit_test_analysis_incomplete',
      message:
        'Static analysis found no inspectable explicit *.unit.test.* or *.unit.spec.* tests.',
      priority: 'critical',
      remediation:
        'Add direct test() or it() declarations with inline callbacks and observable assertions.',
      severity: 'error',
    });
  }
  if (unit.testCount !== null && unit.testCount !== after.testCount) {
    violations.push({
      code: 'unit_test_execution_mismatch',
      message: `Vitest reported ${unit.testCount} test${unit.testCount === 1 ? '' : 's'}, but static analysis could reconcile only ${after.testCount} explicit test declaration${after.testCount === 1 ? '' : 's'}.`,
      priority: 'critical',
      remediation:
        'Use direct test() or it() declarations in explicit unit files; remove dynamic, conditional, aliased, or generated test registration so every executed test is auditable.',
      severity: 'error',
    });
  }
  if (
    after.testCount > 0 &&
    after.testsWithMeaningfulAssertions !== after.testCount
  ) {
    violations.push({
      code: 'unit_assertion_quality',
      message: `${after.testsWithMeaningfulAssertions} of ${after.testCount} explicit unit tests contain a statically meaningful assertion.`,
      priority: 'critical',
      remediation:
        'Give every enabled unit test an inline expect() or assert() check derived from production behavior; literal-only assertions are not evidence.',
      severity: 'error',
    });
  }
  return Array.from(
    new Map(
      violations.map((violation) => [
        [
          violation.code,
          violation.file || '',
          violation.line || 0,
          violation.column || 0,
          violation.message,
        ].join('\u0000'),
        violation,
      ]),
    ).values(),
  );
}

function unitFailureViolation(
  unit: VitestCoverageRunResult,
): ValidationViolation | null {
  if (unit.passed) return null;
  const code = unitFailureCode(unit);
  const output = outputTail(unit.stderr || unit.stdout);
  const message = unit.failureMessage || 'The independent Vitest run failed.';
  return {
    code,
    message,
    priority: 'critical',
    remediation: [
      unit.failure === 'no_tests'
        ? 'Add focused *.unit.test.* or *.unit.spec.* tests for production logic and negative branches.'
        : 'Fix the unit tests or coverage instrumentation, then rerun playrunner-validator.',
      output ? `Recent output:\n${output}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    severity: 'error',
  };
}

function attachUnitResult(
  validation: ValidationResult,
  unit: VitestCoverageRunResult,
  analysis: ExplicitUnitTestAnalysis,
  sourceStable: boolean,
  blocking: ValidationViolation[],
): ValidationResult {
  validation.unitTestRun = {
    analyzedFiles: analysis.fileCount,
    analyzedTests: analysis.testCount,
    args: unit.args,
    branchCoverage: unit.branchCoverage,
    command: unit.command,
    coverageReport: unit.coverageReportPath,
    durationMs: unit.durationMs,
    exitCode: unit.code,
    failure: unit.failure || (blocking.length ? 'static_quality_gate' : null),
    failureMessage:
      unit.failureMessage ||
      (blocking.length
        ? 'The explicit unit suite did not pass static assertion-quality and execution reconciliation.'
        : null),
    lcovReport: unit.lcovReportPath,
    lineCoverage: unit.lineCoverage,
    passed: unit.passed && blocking.length === 0,
    stderrTail: outputTail(unit.stderr),
    stdoutTail: outputTail(unit.stdout),
    sourceStable,
    testCount: unit.testCount,
    testsWithMeaningfulAssertions: analysis.testsWithMeaningfulAssertions,
    testResults: unit.testResultsPath,
    timedOut: unit.timedOut,
  };
  if (unit.testResultsPath || unit.coverageReportPath) {
    validation.artifacts.testResults = 'test-results';
  }
  if (!blocking.length) return validation;

  const previousTotal =
    validation.violationSummary?.total ?? validation.violations.length;
  validation.violations = [...blocking, ...validation.violations].slice(
    0,
    MAX_VIOLATIONS,
  );
  validation.violationSummary = {
    reported: validation.violations.length,
    total: previousTotal + blocking.length,
    truncated:
      validation.violationSummary?.truncated === true ||
      previousTotal + blocking.length > validation.violations.length,
  };
  const findings = blocking.map((violation) => ({
    code: violation.code,
    ...(violation.file
      ? {
          location: `${violation.file}${violation.line ? `:${violation.line}${violation.column ? `:${violation.column}` : ''}` : ''}`,
        }
      : {}),
    message: violation.message,
    priority: violation.priority,
    remediation: violation.remediation,
  }));
  const previousFeedbackTotal =
    validation.feedback.total ?? validation.feedback.items.length;
  validation.feedback.items = [...findings, ...validation.feedback.items].slice(
    0,
    MAX_FEEDBACK_ITEMS,
  );
  validation.feedback.reported = validation.feedback.items.length;
  validation.feedback.total = previousFeedbackTotal + findings.length;
  validation.feedback.truncated =
    validation.feedback.items.length < (validation.feedback.total || 0);
  validation.feedback.summary = `Validation failed because the independent Vitest unit-test and assertion-quality layer did not pass${previousTotal ? `, with ${previousTotal} additional blocking finding${previousTotal === 1 ? '' : 's'}` : ''}.`;
  validation.feedbackText = truncateStart(
    [
      validation.feedback.summary,
      ...blocking.flatMap((violation) => [
        `[${violation.code}] ${violation.message}`,
        `Fix: ${violation.remediation}`,
      ]),
      validation.feedbackText === 'Validation passed.'
        ? ''
        : validation.feedbackText,
    ]
      .filter(Boolean)
      .join('\n'),
    MAX_FEEDBACK_TEXT_BYTES,
  );
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
  const validation = await (options.validateBrowser || validatePlaywrightTests)(
    cwd,
    config,
    options,
  );
  if (config.runTests === false || config.unitCoverage !== true) {
    return validation;
  }

  const configuredTimeoutMs =
    Math.min(120, Math.max(1, Number(config.validationTimeoutMinutes) || 30)) *
    60_000;
  const supervisorRemainingMs =
    options.timeoutMs === undefined
      ? Number.POSITIVE_INFINITY
      : options.timeoutMs - (Date.now() - startedAt);
  const timeoutMs = Math.max(
    1,
    Math.min(configuredTimeoutMs, supervisorRemainingMs),
  );
  const minimum = {
    branchCoverage: Math.min(
      100,
      Math.max(0, Number(config.minimum?.branchCoverage) || 0),
    ),
    lineCoverage: Math.min(
      100,
      Math.max(0, Number(config.minimum?.lineCoverage) || 0),
    ),
  };
  const analyzeUnitTests = options.analyzeUnitTests || analyzeExplicitUnitTests;
  const unitAnalysisBefore = analyzeUnitTests(cwd);
  const unit = await (
    options.runUnitCoverage ||
    ((root, timeout, thresholds) =>
      runVitestCoverage(root, {
        environment: createCredentialFreeEnvironment({}, process.env),
        minimumBranchCoverage: thresholds.branchCoverage,
        minimumLineCoverage: thresholds.lineCoverage,
        timeoutMs: timeout,
      }))
  )(cwd, timeoutMs, minimum);
  const unitAnalysisAfter = analyzeUnitTests(cwd);
  const qualityViolations = unitQualityViolations(
    unitAnalysisBefore,
    unitAnalysisAfter,
    unit,
  );
  const executionFailure = unitFailureViolation(unit);
  const blocking = executionFailure
    ? [executionFailure, ...qualityViolations]
    : qualityViolations;
  const sourceStable =
    unitAnalysisBefore.fingerprint === unitAnalysisAfter.fingerprint &&
    unitAnalysisBefore.fileCount === unitAnalysisAfter.fileCount;
  const result = attachUnitResult(
    validation,
    unit,
    unitAnalysisAfter,
    sourceStable,
    blocking,
  );
  result.durationMs = Date.now() - startedAt;
  result.completedAt = new Date().toISOString();
  return result;
}
