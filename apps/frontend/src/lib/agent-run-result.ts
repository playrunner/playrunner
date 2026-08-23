type JsonRecord = Record<string, unknown>;

export type ValidationDimensionSummary = {
  applicable: boolean;
  key: string;
  label: string;
  minimum: number | null;
  observed: number | null;
  passed: boolean;
};

export type UnitRunSummary = {
  analyzedTests: number | null;
  branchCoverage: number | null;
  failure: string | null;
  lineCoverage: number | null;
  passed: boolean;
  testCount: number | null;
  testsWithMeaningfulAssertions: number | null;
};

export type ArtifactLink = {
  label: string;
  path: string;
};

export type AgentRunResultSummary = {
  artifacts: ArtifactLink[];
  attempts: number | null;
  available: boolean;
  dimensions: ValidationDimensionSummary[];
  failure: string | null;
  status: 'failed' | 'passed' | 'unknown';
  stopReason: string | null;
  unitRun: UnitRunSummary | null;
  validationStatus: 'failed' | 'passed' | 'unknown';
};

const DIMENSION_LABELS: Record<string, string> = {
  assertionQuality: 'Assertion quality',
  branchCoverage: 'Branch coverage',
  changedLineCoverage: 'Changed-line coverage',
  lineCoverage: 'Line coverage',
  requirementCoverage: 'Requirement coverage',
};

const ARTIFACT_LABELS: Record<string, string> = {
  artifactManifest: 'Artifact manifest',
  artifactTruncation: 'Artifact truncation manifest',
  browserCoverage: 'Browser coverage',
  coverage: 'Browser coverage',
  patch: 'Generated patch',
  playwrightReport: 'Playwright report',
  repositoryStatus: 'Repository status',
  traces: 'Playwright trace',
  validationHistory: 'Validation history',
  validationReport: 'Validation report',
  vitestCoverage: 'Unit coverage JSON',
  vitestLcov: 'Unit coverage LCOV',
  vitestResults: 'Vitest results',
};

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function resultStatus(value: unknown): 'failed' | 'passed' | 'unknown' {
  return value === 'passed' || value === 'failed' ? value : 'unknown';
}

function isAuthenticatedArtifactPath(value: string): boolean {
  return (
    value.startsWith('/outputs/') &&
    !value.includes('\\') &&
    !value.split('/').includes('..') &&
    /^\/outputs\/[A-Za-z0-9._/-]+$/.test(value)
  );
}

function artifactLabel(key: string, index?: number): string {
  const label = ARTIFACT_LABELS[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2');
  return index === undefined ? label : `${label} ${index + 1}`;
}

function artifactLinks(output: JsonRecord, validation: JsonRecord) {
  const links: ArtifactLink[] = [];
  const seen = new Set<string>();
  for (const artifacts of [
    record(output.artifacts),
    record(validation.artifacts),
  ]) {
    for (const [key, candidate] of Object.entries(artifacts)) {
      const values = Array.isArray(candidate) ? candidate : [candidate];
      values.forEach((value, index) => {
        const artifactPath = nonEmptyString(value);
        if (
          !artifactPath ||
          (key === 'testResults' && artifactPath.endsWith('/test-results')) ||
          !isAuthenticatedArtifactPath(artifactPath) ||
          seen.has(artifactPath)
        ) {
          return;
        }
        seen.add(artifactPath);
        links.push({
          label: artifactLabel(
            key,
            Array.isArray(candidate) ? index : undefined,
          ),
          path: artifactPath,
        });
      });
    }
  }
  return links;
}

function latestAgentError(output: JsonRecord): string | null {
  const attempts = Array.isArray(output.attemptHistory)
    ? output.attemptHistory
    : [];
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    const error = nonEmptyString(record(record(attempts[index]).agent).error);
    if (error) return error;
  }
  return null;
}

export function summarizeAgentRunResult(value: unknown): AgentRunResultSummary {
  const output = record(value);
  const available = Object.keys(output).length > 0;
  const validation = record(output.validation);
  const dimensions = Object.entries(record(validation.dimensions)).flatMap(
    ([key, candidate]) => {
      const dimension = record(candidate);
      if (!Object.hasOwn(dimension, 'passed')) return [];
      return [
        {
          applicable: dimension.applicable !== false,
          key,
          label: DIMENSION_LABELS[key] || key,
          minimum: finiteNumber(dimension.minimum),
          observed: finiteNumber(dimension.observed),
          passed: dimension.passed === true,
        },
      ];
    },
  );
  const unit = record(validation.unitTestRun);
  const unitRun = Object.keys(unit).length
    ? {
        analyzedTests: finiteNumber(unit.analyzedTests),
        branchCoverage: finiteNumber(unit.branchCoverage),
        failure:
          nonEmptyString(unit.failureMessage) ?? nonEmptyString(unit.failure),
        lineCoverage: finiteNumber(unit.lineCoverage),
        passed: unit.passed === true,
        testCount: finiteNumber(unit.testCount),
        testsWithMeaningfulAssertions: finiteNumber(
          unit.testsWithMeaningfulAssertions,
        ),
      }
    : null;
  const failure =
    nonEmptyString(record(output.failure).message) ??
    nonEmptyString(output.deliveryError) ??
    nonEmptyString(output.runnerError) ??
    nonEmptyString(output.repositoryError) ??
    nonEmptyString(output.artifactError) ??
    latestAgentError(output) ??
    nonEmptyString(validation.feedbackText) ??
    unitRun?.failure ??
    null;

  return {
    artifacts: artifactLinks(output, validation),
    attempts: finiteNumber(output.attempts),
    available,
    dimensions,
    failure,
    status: resultStatus(output.status),
    stopReason: nonEmptyString(output.stopReason),
    unitRun,
    validationStatus: resultStatus(validation.status),
  };
}
