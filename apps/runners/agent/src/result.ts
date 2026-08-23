import type { SupervisorResult } from './supervisor';
import type { ValidationResult } from './validator';
import type { AgentArtifactRefs } from './artifacts';
import {
  assertNoProhibitedExactValues,
  credentialSafeErrorMessage,
} from './secret-values';

export const MAX_INLINE_RESULT_BYTES = 6 * 1_024 * 1_024;
const MAX_INLINE_TEXT_BYTES = 16 * 1_024;
const MAX_INLINE_FEEDBACK_ITEMS = 50;
const MAX_INLINE_REQUIREMENTS = 25;
const MAX_INLINE_REQUIREMENT_EVIDENCE = 3;
const MAX_INLINE_VIOLATIONS = 50;
const MAX_INLINE_FAILURE_KIND_BYTES = 256;
const AUTHENTICATED_PLAYWRIGHT_REPORT_PATTERN =
  /^\/outputs\/[A-Za-z0-9][A-Za-z0-9._-]{0,254}\/[A-Za-z0-9][A-Za-z0-9._-]{0,254}\/playwright-report\/index\.html$/;

function truncateUtf8(value: string, maximumBytes: number): string {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= maximumBytes) return value;
  let start = maximumBytes;
  while (start > 0 && (bytes[start] & 0xc0) === 0x80) start -= 1;
  return bytes.subarray(0, start).toString('utf8');
}

export function createInlineAttemptHistory(supervisor: SupervisorResult) {
  return supervisor.attemptHistory.map((attempt) => ({
    agent: {
      completedAt: attempt.agent.completedAt,
      durationMs: attempt.agent.durationMs,
      ...(attempt.agent.error
        ? { error: truncateUtf8(attempt.agent.error, 2_000) }
        : {}),
      startedAt: attempt.agent.startedAt,
      status: attempt.agent.status,
    },
    attempt: attempt.attempt,
    ...(attempt.validation
      ? {
          validation: {
            attempt: attempt.validation.attempt,
            durationMs: attempt.validation.durationMs,
            failedTests: attempt.validation.testRun.failedTests.length,
            feedback: truncateUtf8(attempt.validation.feedback.summary, 2_000),
            passed: attempt.validation.passed,
            report: attempt.validation.artifacts.validationReport,
            status: attempt.validation.status,
            violations:
              attempt.validation.violationSummary?.total ??
              attempt.validation.violations.length,
            ...(attempt.validation.unitTestRun
              ? {
                  unitTests: {
                    passed: attempt.validation.unitTestRun.passed,
                    testCount: attempt.validation.unitTestRun.testCount,
                  },
                }
              : {}),
          },
        }
      : {}),
  }));
}

function compactValidation(validation: ValidationResult) {
  const feedbackItems = validation.feedback.items
    .slice(0, MAX_INLINE_FEEDBACK_ITEMS)
    .map((item) => ({
      ...item,
      ...(item.location
        ? { location: truncateUtf8(item.location, 1_000) }
        : {}),
      message: truncateUtf8(item.message, 2_000),
      remediation: truncateUtf8(item.remediation, 2_000),
    }));
  const requirementItems = validation.requirements.items
    .slice(0, MAX_INLINE_REQUIREMENTS)
    .map((item) => ({
      ...item,
      description: truncateUtf8(item.description, 2_000),
      evidence: item.evidence
        .slice(0, MAX_INLINE_REQUIREMENT_EVIDENCE)
        .map((evidence) => ({
          ...evidence,
          file: truncateUtf8(evidence.file, 1_000),
          test: truncateUtf8(evidence.test, 1_000),
        })),
      evidenceTotal: item.evidenceTotal ?? item.evidence.length,
      evidenceTruncated:
        Boolean(item.evidenceTruncated) ||
        item.evidence.length > MAX_INLINE_REQUIREMENT_EVIDENCE,
      id: truncateUtf8(item.id, 500),
    }));
  const violations = validation.violations
    .slice(0, MAX_INLINE_VIOLATIONS)
    .map((violation) => ({
      ...violation,
      code: truncateUtf8(violation.code, 500),
      ...(violation.file ? { file: truncateUtf8(violation.file, 1_000) } : {}),
      message: truncateUtf8(violation.message, 2_000),
      remediation: truncateUtf8(violation.remediation, 2_000),
    }));
  const feedbackText = truncateUtf8(
    validation.feedbackText,
    MAX_INLINE_TEXT_BYTES,
  );
  return {
    artifacts: validation.artifacts,
    attempt: validation.attempt,
    authoritative: validation.authoritative,
    changedCoverage: validation.changedCoverage,
    completedAt: validation.completedAt,
    coverageEvidence: validation.coverageEvidence,
    dimensions: validation.dimensions,
    durationMs: validation.durationMs,
    feedback: {
      items: feedbackItems,
      reported: feedbackItems.length,
      summary: truncateUtf8(validation.feedback.summary, MAX_INLINE_TEXT_BYTES),
      total: validation.feedback.total ?? validation.feedback.items.length,
      truncated:
        Boolean(validation.feedback.truncated) ||
        validation.feedback.items.length > feedbackItems.length,
    },
    feedbackText,
    feedbackTextTruncated:
      Buffer.byteLength(validation.feedbackText, 'utf8') >
      Buffer.byteLength(feedbackText, 'utf8'),
    inlineTruncation: {
      feedbackItems: validation.feedback.items.length > feedbackItems.length,
      feedbackText:
        Buffer.byteLength(validation.feedbackText, 'utf8') >
        Buffer.byteLength(feedbackText, 'utf8'),
      requirements:
        validation.requirements.items.length > requirementItems.length,
      violations: validation.violations.length > violations.length,
    },
    passed: validation.passed,
    requirements: {
      configuredTotal: validation.requirements.configuredTotal,
      covered: validation.requirements.covered,
      items: requirementItems,
      reported: requirementItems.length,
      total: validation.requirements.total,
      truncated:
        Boolean(validation.requirements.truncated) ||
        validation.requirements.items.length > requirementItems.length ||
        requirementItems.some((item) => item.evidenceTruncated),
    },
    schemaVersion: validation.schemaVersion,
    startedAt: validation.startedAt,
    status: validation.status,
    testRun: {
      command: validation.testRun.command,
      durationMs: validation.testRun.durationMs,
      exitCode: validation.testRun.exitCode,
      failedTests: validation.testRun.failedTests.slice(0, 100),
      passed: validation.testRun.passed,
      stderrTail: truncateUtf8(
        validation.testRun.stderrTail,
        MAX_INLINE_TEXT_BYTES,
      ),
      stdoutTail: truncateUtf8(
        validation.testRun.stdoutTail,
        MAX_INLINE_TEXT_BYTES,
      ),
      timedOut: validation.testRun.timedOut,
    },
    testSummary: validation.testSummary,
    ...(validation.unitTestRun
      ? {
          unitTestRun: {
            ...validation.unitTestRun,
            args: validation.unitTestRun.args.slice(0, 100),
            failureMessage: validation.unitTestRun.failureMessage
              ? truncateUtf8(
                  validation.unitTestRun.failureMessage,
                  MAX_INLINE_TEXT_BYTES,
                )
              : null,
            stderrTail: truncateUtf8(
              validation.unitTestRun.stderrTail,
              MAX_INLINE_TEXT_BYTES,
            ),
            stdoutTail: truncateUtf8(
              validation.unitTestRun.stdoutTail,
              MAX_INLINE_TEXT_BYTES,
            ),
          },
        }
      : {}),
    violationSummary: {
      reported: violations.length,
      total: validation.violationSummary?.total ?? validation.violations.length,
      truncated:
        Boolean(validation.violationSummary?.truncated) ||
        validation.violations.length > violations.length,
    },
    violations,
  };
}

export function createInlineFailure(
  kind: string,
  message: string,
  prohibitedExactValues: readonly string[] = [],
) {
  return {
    kind: truncateUtf8(
      String(kind || 'unknown').trim(),
      MAX_INLINE_FAILURE_KIND_BYTES,
    ),
    message: truncateUtf8(
      credentialSafeErrorMessage(message, prohibitedExactValues),
      MAX_INLINE_TEXT_BYTES,
    ),
  };
}

export function authenticatedPlaywrightReportUrl(
  artifacts: AgentArtifactRefs | undefined,
): string | undefined {
  const report = artifacts?.playwrightReport;
  return typeof report === 'string' &&
    AUTHENTICATED_PLAYWRIGHT_REPORT_PATTERN.test(report)
    ? report
    : undefined;
}

export function createInlineValidatorResult(
  validation: ValidationResult,
  options: {
    artifactError?: string;
    artifacts?: AgentArtifactRefs;
    attempts?: number;
    prohibitedExactValues?: readonly string[];
    stopReason?: string;
  } = {},
): Record<string, unknown> {
  const reportUrl = authenticatedPlaywrightReportUrl(options.artifacts);
  const prohibitedExactValues = options.prohibitedExactValues || [];
  const artifactError = options.artifactError
    ? truncateUtf8(
        credentialSafeErrorMessage(
          options.artifactError,
          prohibitedExactValues,
        ),
        MAX_INLINE_TEXT_BYTES,
      )
    : undefined;
  const failureMessage =
    artifactError ||
    (validation.passed ? undefined : validation.feedback.summary);
  const status = artifactError ? 'failed' : validation.status;
  const stopReason = artifactError
    ? 'artifact_failed'
    : options.stopReason ||
      (validation.passed ? 'passed' : 'validation_failed');
  const createResult = (
    inlineValidation: ValidationResult | ReturnType<typeof compactValidation>,
    validationTruncated: boolean,
  ) => ({
    ...(artifactError ? { artifactError } : {}),
    ...(options.artifacts ? { artifacts: options.artifacts } : {}),
    attempts: options.attempts ?? validation.attempt,
    ...(failureMessage
      ? {
          failure: createInlineFailure(
            stopReason,
            failureMessage,
            prohibitedExactValues,
          ),
        }
      : {}),
    ...(reportUrl ? { reportUrl } : {}),
    status,
    stopReason,
    validation: inlineValidation,
    ...(validationTruncated ? { validationTruncated: true } : {}),
  });

  let result = createResult(validation, false);
  if (
    Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_INLINE_RESULT_BYTES
  ) {
    result = createResult(compactValidation(validation), true);
  }
  if (
    Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_INLINE_RESULT_BYTES
  ) {
    throw new Error(
      `Validator attachment result exceeds ${MAX_INLINE_RESULT_BYTES} bytes after compaction.`,
    );
  }
  assertNoProhibitedExactValues(JSON.stringify(result), prohibitedExactValues);
  return result;
}

export function boundInlineAgentResult(
  input: Record<string, unknown>,
  validation: ValidationResult | null,
): Record<string, unknown> {
  const result = { ...input };
  if (
    Buffer.byteLength(JSON.stringify(result), 'utf8') <= MAX_INLINE_RESULT_BYTES
  ) {
    return result;
  }
  if (validation) {
    result.validation = compactValidation(validation);
    result.validationTruncated = true;
  }
  if (
    Buffer.byteLength(JSON.stringify(result), 'utf8') >
      MAX_INLINE_RESULT_BYTES &&
    typeof result.repositoryStatus === 'string'
  ) {
    result.repositoryStatus = truncateUtf8(
      result.repositoryStatus,
      MAX_INLINE_TEXT_BYTES,
    );
    result.repositoryStatusTruncated = true;
  }
  if (
    Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_INLINE_RESULT_BYTES
  ) {
    throw new Error(
      `AI Container inline result exceeds ${MAX_INLINE_RESULT_BYTES} bytes after compaction.`,
    );
  }
  return result;
}

export function truncateInlinePatch(value: string, maximumBytes: number) {
  return truncateUtf8(value, maximumBytes);
}
