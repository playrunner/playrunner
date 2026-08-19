import fs from 'fs';
import path from 'path';
import { runProcess } from './process';

export type ValidationViolation = {
  code: string;
  file?: string;
  message: string;
  severity: 'error' | 'warning';
};

export type ValidationResult = {
  assertionQuality: number;
  branchCoverage: number | null;
  feedback: string;
  lineCoverage: number | null;
  passed: boolean;
  requirementCoverage: number;
  testRun: { passed: boolean; exitCode: number };
  violations: ValidationViolation[];
};

type ValidatorConfig = {
  failOn?: string[];
  minimum?: Record<string, number>;
  requirements?: string;
  runTests?: boolean;
};

const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'playwright-report',
  'test-results',
]);

function collectTestFiles(directory: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...collectTestFiles(fullPath));
    else if (/\.(spec|test)\.[cm]?[jt]sx?$/.test(entry.name))
      result.push(fullPath);
  }
  return result;
}

function readCoverage(cwd: string) {
  const candidates = [
    path.join(cwd, 'coverage', 'coverage-summary.json'),
    path.join(cwd, 'coverage-summary.json'),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const summary = JSON.parse(fs.readFileSync(candidate, 'utf8')).total;
      return {
        branchCoverage: Number(summary?.branches?.pct),
        lineCoverage: Number(summary?.lines?.pct),
      };
    } catch {
      // A malformed optional coverage artifact is reported as unavailable.
    }
  }
  return { branchCoverage: null, lineCoverage: null };
}

function thresholdViolation(
  value: number | null,
  minimum: number,
  label: string,
  code: string,
): ValidationViolation | null {
  if (!minimum) return null;
  if (value == null || !Number.isFinite(value)) {
    return {
      code,
      message: `${label} is required at ${minimum}%, but no coverage result was produced.`,
      severity: 'error',
    };
  }
  return value < minimum
    ? {
        code,
        message: `${label} is ${value.toFixed(1)}%; required minimum is ${minimum}%.`,
        severity: 'error',
      }
    : null;
}

export async function validatePlaywrightTests(
  cwd: string,
  config: ValidatorConfig,
): Promise<ValidationResult> {
  const files = collectTestFiles(cwd);
  const violations: ValidationViolation[] = [];
  let tests = 0;
  let testsWithAssertions = 0;
  const combinedSources: string[] = [];

  if (!files.length) {
    violations.push({
      code: 'untested_critical_path',
      message: 'No Playwright test files were found.',
      severity: 'error',
    });
  }

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    combinedSources.push(source);
    const relative = path.relative(cwd, file);
    const testMatches = [
      ...source.matchAll(/\btest(?:\.(?:only|skip|fixme))?\s*\(/g),
    ];
    tests += testMatches.length;
    const zeroAssertionTests = testMatches.filter((match, index) => {
      const start = match.index || 0;
      const end = testMatches[index + 1]?.index || source.length;
      const hasAssertion = /\bexpect\s*\(/.test(source.slice(start, end));
      if (hasAssertion) testsWithAssertions += 1;
      return !hasAssertion;
    }).length;
    if (zeroAssertionTests > 0) {
      violations.push({
        code: 'zero_assertion_test',
        file: relative,
        message: `${zeroAssertionTests} test${zeroAssertionTests === 1 ? '' : 's'} contain no expect() assertion.`,
        severity: 'error',
      });
    }
    if (/\.waitForTimeout\s*\(/.test(source)) {
      violations.push({
        code: 'hardcoded_wait',
        file: relative,
        message:
          'Uses page.waitForTimeout(); wait for an observable condition instead.',
        severity: 'error',
      });
    }
    if (/\b(?:test|describe)\.only\s*\(/.test(source)) {
      violations.push({
        code: 'focused_test',
        file: relative,
        message: 'Contains .only and would exclude other tests.',
        severity: 'error',
      });
    }
  }

  const requirements = String(config.requirements || '')
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  const sourceText = combinedSources.join('\n').toLowerCase();
  const coveredRequirements = requirements.filter((requirement) => {
    const id = requirement.split(':', 1)[0].trim().toLowerCase();
    return id.length > 1 && sourceText.includes(id);
  });
  const requirementCoverage = requirements.length
    ? (coveredRequirements.length / requirements.length) * 100
    : 100;
  if (coveredRequirements.length < requirements.length) {
    const missing = requirements.filter(
      (item) => !coveredRequirements.includes(item),
    );
    violations.push({
      code: 'skipped_requirement',
      message: `Missing requirements: ${missing.join(', ')}`,
      severity: 'error',
    });
  }

  const testRun =
    config.runTests === false
      ? { code: 0, stderr: '', stdout: '' }
      : await runProcess(
          'npx',
          ['playwright', 'test', '--reporter=line', '--retries=0'],
          {
            cwd,
            env: process.env,
            stream: true,
          },
        );
  if (config.runTests !== false && testRun.code !== 0) {
    violations.push({
      code: 'test_failure',
      message: 'The Playwright suite does not pass with retries disabled.',
      severity: 'error',
    });
  }

  const assertionQuality = tests ? (testsWithAssertions / tests) * 100 : 0;
  const coverage = readCoverage(cwd);
  const minimum = config.minimum || {};
  for (const violation of [
    thresholdViolation(
      coverage.lineCoverage,
      minimum.lineCoverage || 0,
      'Line coverage',
      'line_coverage',
    ),
    thresholdViolation(
      coverage.branchCoverage,
      minimum.branchCoverage || 0,
      'Branch coverage',
      'branch_coverage',
    ),
    thresholdViolation(
      requirementCoverage,
      minimum.requirementCoverage || 0,
      'Requirement coverage',
      'requirement_coverage',
    ),
    thresholdViolation(
      assertionQuality,
      minimum.assertionQuality || 0,
      'Assertion quality',
      'assertion_quality',
    ),
  ]) {
    if (violation) violations.push(violation);
  }

  const failOn = new Set(config.failOn || []);
  const blocking = violations.filter(
    (violation) =>
      violation.severity === 'error' &&
      (failOn.size === 0 ||
        failOn.has(violation.code) ||
        [
          'test_failure',
          'focused_test',
          'line_coverage',
          'branch_coverage',
          'requirement_coverage',
          'assertion_quality',
        ].includes(violation.code)),
  );
  const feedback = blocking.length
    ? `Validation failed:\n${blocking.map((item) => `- [${item.code}] ${item.file ? `${item.file}: ` : ''}${item.message}`).join('\n')}`
    : 'Validation passed.';

  return {
    assertionQuality,
    branchCoverage: coverage.branchCoverage,
    feedback,
    lineCoverage: coverage.lineCoverage,
    passed: blocking.length === 0,
    requirementCoverage,
    testRun: { passed: testRun.code === 0, exitCode: testRun.code },
    violations,
  };
}
