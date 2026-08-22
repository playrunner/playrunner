import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { runProcess, type ProcessResult } from './process';
import type { ChangeManifest } from './repository';

export const VALIDATION_SCHEMA_VERSION = '1.0';

export const DEFAULT_MINIMUMS = {
  assertionQuality: 100,
  branchCoverage: 70,
  changedLineCoverage: 80,
  lineCoverage: 80,
  requirementCoverage: 100,
} as const;

export const DEFAULT_FAIL_ON = [
  'zero_assertion_test',
  'trivial_assertion',
  'hardcoded_wait',
  'skipped_test',
  'focused_test',
  'expected_failure_test',
  'retry_dependence',
  'weak_selector',
  'skipped_requirement',
  'untested_critical_path',
] as const;

export const DEFAULT_COVERAGE_SUMMARY_PATHS = [
  'coverage/coverage-final.json',
  'coverage/lcov.info',
] as const;

const FIXED_DETAILED_COVERAGE_PATHS = new Set<string>(
  DEFAULT_COVERAGE_SUMMARY_PATHS,
);

export const DEFAULT_VALIDATION_COMMAND =
  'playwright test --reporter=line --retries=0';
const LEGACY_VALIDATION_COMMAND =
  'npm run test:coverage -- --reporter=line --retries=0';

export const VALIDATOR_LIMITS = {
  coveragePathBytes: 512,
  coveragePathCount: 20,
  failOnCodeBytes: 128,
  failOnCodeCount: 100,
  failedTestCount: 20,
  failedTestNameBytes: 300,
  feedbackItems: 100,
  feedbackTextBytes: 64 * 1024,
  changedCoverageFiles: 2_000,
  changedCoverageLines: 250_000,
  changedCoverageRanges: 50_000,
  changedCoverageReportedFiles: 25,
  changedCoverageReportedLinesPerFile: 50,
  inlineCommandBytes: 2 * 1024,
  inlineResultBytes: 8 * 1024 * 1024,
  requirementCount: 100,
  requirementDescriptionBytes: 1_000,
  requirementEvidencePerItem: 10,
  requirementEvidenceTotal: 1_000,
  requirementIdBytes: 200,
  requirementSourceBytes: 256 * 1024,
  testTitleBytes: 300,
  validationCommandBytes: 8 * 1024,
  violationCodeBytes: 128,
  violationFileBytes: 512,
  violationMessageBytes: 1_024,
  violationRemediationBytes: 2_048,
  violations: 1_000,
} as const;

type ValidationPriority = 'critical' | 'high' | 'medium' | 'low';
type ValidationSeverity = 'error' | 'warning';

export type ValidationViolation = {
  code: string;
  column?: number;
  file?: string;
  line?: number;
  message: string;
  priority: ValidationPriority;
  remediation: string;
  severity: ValidationSeverity;
};

export type ValidationDimension = {
  minimum: number;
  observed: number | null;
  passed: boolean;
};

export type RequirementEvidence = {
  critical: boolean;
  description: string;
  evidence: Array<{
    file: string;
    line: number;
    test: string;
  }>;
  evidenceTotal?: number;
  evidenceTruncated?: boolean;
  id: string;
  passed: boolean;
};

export type ValidationResult = {
  artifacts: {
    coverage?: string;
    playwrightReport?: string;
    testResults?: string;
    traces: string[];
    validationReport?: string;
  };
  attempt: number;
  /** The supervisor controlled command timing and freshness cleanup. This does not attest repository-produced coverage. */
  authoritative: boolean;
  completedAt: string;
  coverageEvidence?: {
    detailed: true;
    fresh: boolean;
    provenance: 'repository_reported_untrusted';
    reviewRequired: true;
    sourcePath: string;
  };
  changedCoverage?: {
    applicable: boolean;
    coveredLines: number;
    instrumentedFiles: number;
    missingFiles: string[];
    productionFiles: number;
    totalLines: number;
    uncovered: Array<{
      file: string;
      lines: number[];
      total: number;
      truncated: boolean;
    }>;
    truncated: boolean;
  };
  dimensions: {
    assertionQuality: ValidationDimension;
    branchCoverage: ValidationDimension;
    changedLineCoverage: ValidationDimension & { applicable: boolean };
    lineCoverage: ValidationDimension;
    requirementCoverage: ValidationDimension;
  };
  durationMs: number;
  feedback: {
    items: Array<{
      code: string;
      location?: string;
      message: string;
      priority: ValidationPriority;
      remediation: string;
    }>;
    reported?: number;
    summary: string;
    total?: number;
    truncated?: boolean;
  };
  feedbackText: string;
  passed: boolean;
  requirements: {
    configuredTotal?: number;
    covered: number;
    items: RequirementEvidence[];
    reported?: number;
    total: number;
    truncated?: boolean;
  };
  schemaVersion: typeof VALIDATION_SCHEMA_VERSION;
  startedAt: string;
  status: 'passed' | 'failed';
  testRun: {
    command: string | null;
    durationMs: number;
    exitCode: number;
    failedTests: string[];
    passed: boolean;
    stderrTail: string;
    stdoutTail: string;
    timedOut: boolean;
  };
  testSummary: {
    files: number;
    focused: number;
    skipped: number;
    tests: number;
    testsWithMeaningfulAssertions: number;
  };
  violations: ValidationViolation[];
  violationSummary?: {
    reported: number;
    total: number;
    truncated: boolean;
  };
};

export type ValidatorConfig = {
  coverageSummaryPaths?: string[];
  failOn?: string[];
  minimum?: Partial<Record<keyof typeof DEFAULT_MINIMUMS, number>>;
  requirements?: string;
  runTests?: boolean;
  validationCommand?: string;
  validationTimeoutMinutes?: number;
};

export type ValidatorOptions = {
  attempt?: number;
  authoritative?: boolean;
  changeManifest?: ChangeManifest;
  outputDirectory?: string;
  repositoryRoot?: string;
  runCommand?: (
    command: string,
    cwd: string,
    timeoutMs: number,
  ) => Promise<ProcessResult>;
  timeoutMs?: number;
};

type NormalizedValidatorConfig = Omit<Required<ValidatorConfig>, 'minimum'> & {
  minimum: Record<keyof typeof DEFAULT_MINIMUMS, number>;
};

type CoverageFile = {
  branchCoverage: number | null;
  file: string;
  lineHits: Map<number, number> | null;
  lineCoverage: number | null;
};

type CoverageResult = {
  branchCoverage: number | null;
  detailedLines: boolean;
  files: CoverageFile[];
  lineCoverage: number | null;
  sourcePath?: string;
};

type ChangedCoverageAnalysis = NonNullable<
  ValidationResult['changedCoverage']
> & {
  complete: boolean;
  observed: number | null;
  violations: ValidationViolation[];
};

type AnalyzedTest = {
  expectedFailure: boolean;
  file: string;
  line: number;
  meaningfulAssertion: boolean;
  skipped: boolean;
  strings: string[];
  title: string;
};

type TestAnalysis = {
  focused: number;
  skipped: number;
  tests: AnalyzedTest[];
  testsWithMeaningfulAssertions: number;
  violations: ValidationViolation[];
};

type TestFileCollection = {
  files: string[];
  violations: ValidationViolation[];
};

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.playrunner',
  '__snapshots__',
  'blob-report',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'playwright-report',
  'test-results',
]);
const MAX_COVERAGE_ARTIFACT_BYTES = 100 * 1024 * 1024;
const MAX_FEEDBACK_ITEMS = VALIDATOR_LIMITS.feedbackItems;
const MAX_REPORTED_VIOLATIONS = VALIDATOR_LIMITS.violations;
const MAX_TEST_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TEST_FILES = 5_000;
const MAX_TOTAL_TEST_BYTES = 50 * 1024 * 1024;
const MAX_TEST_DISCOVERY_DEPTH = 64;
const MAX_TEST_DISCOVERY_ENTRIES = 50_000;
const MAX_TEST_DISCOVERY_DURATION_MS = 10_000;
const TEST_DIRECTORY_NAMES = new Set([
  'e2e',
  'integration',
  'playwright',
  'spec',
  'specs',
  'test',
  'tests',
]);
const EXECUTABLE_SOURCE_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cjs',
  '.cpp',
  '.cs',
  '.cts',
  '.dart',
  '.go',
  '.h',
  '.hpp',
  '.java',
  '.js',
  '.jsx',
  '.kt',
  '.kts',
  '.mjs',
  '.mts',
  '.php',
  '.py',
  '.rb',
  '.rs',
  '.scala',
  '.sol',
  '.svelte',
  '.swift',
  '.ts',
  '.tsx',
  '.vue',
]);
const MAX_TRACE_DISCOVERY_DEPTH = 32;
const MAX_TRACE_DISCOVERY_ENTRIES = 10_000;
const MAX_TRACE_DISCOVERY_DURATION_MS = 2_000;
const COVERAGE_CONFIGURATION_FILE =
  /^(?:(?:c8|coverage|jest|playwright|vitest)\.config\.(?:[cm]?[jt]s|json)|\.nycrc(?:\.(?:json|ya?ml))?)$/i;
const COVERAGE_REPORT_MARKER =
  /(?:__coverage__|node_v8_coverage|\.nyc_output|coverage-(?:final|summary)\.json|lcov\.info)/i;
const COVERAGE_WRITE_METHODS = new Set([
  'appendFile',
  'appendFileSync',
  'copyFile',
  'copyFileSync',
  'cp',
  'cpSync',
  'createWriteStream',
  'link',
  'linkSync',
  'open',
  'openSync',
  'rename',
  'renameSync',
  'symlink',
  'symlinkSync',
  'truncate',
  'truncateSync',
  'write',
  'writeFile',
  'writeFileSync',
  'writeSync',
]);
const FILESYSTEM_MODULES = new Set([
  'fs',
  'fs/promises',
  'node:fs',
  'node:fs/promises',
]);
const PROCESS_MODULES = new Set(['child_process', 'node:child_process']);

const PRIORITY_ORDER: Record<ValidationPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const TRUNCATION_MARKER = '…[truncated]';

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function truncateUtf8(value: string, maximumBytes: number): string {
  if (utf8Bytes(value) <= maximumBytes) return value;
  const marker =
    utf8Bytes(TRUNCATION_MARKER) <= maximumBytes
      ? TRUNCATION_MARKER
      : TRUNCATION_MARKER.slice(0, maximumBytes);
  const available = Math.max(0, maximumBytes - utf8Bytes(marker));
  let low = 0;
  let high = Math.min(value.length, available);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (utf8Bytes(value.slice(0, middle)) <= available) low = middle;
    else high = middle - 1;
  }
  return `${value.slice(0, low)}${marker}`;
}

function invalidConfiguration(
  message: string,
  remediation: string,
): ValidationViolation {
  return {
    code: 'invalid_validator_configuration',
    message,
    priority: 'critical',
    remediation,
    severity: 'error',
  };
}

function clampPercentage(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(0, parsed));
}

function normalizeConfig(config: ValidatorConfig): NormalizedValidatorConfig {
  const configuredPaths = Array.isArray(config.coverageSummaryPaths)
    ? config.coverageSummaryPaths
        .map((value) => String(value).trim())
        .filter(Boolean)
    : [];
  const minimum = config.minimum || {};
  return {
    coverageSummaryPaths: configuredPaths.length
      ? configuredPaths
      : [...DEFAULT_COVERAGE_SUMMARY_PATHS],
    failOn: Array.isArray(config.failOn)
      ? Array.from(new Set(config.failOn.map(String).filter(Boolean)))
      : [...DEFAULT_FAIL_ON],
    minimum: {
      assertionQuality: clampPercentage(
        minimum.assertionQuality,
        DEFAULT_MINIMUMS.assertionQuality,
      ),
      branchCoverage: clampPercentage(
        minimum.branchCoverage,
        DEFAULT_MINIMUMS.branchCoverage,
      ),
      changedLineCoverage: clampPercentage(
        minimum.changedLineCoverage,
        DEFAULT_MINIMUMS.changedLineCoverage,
      ),
      lineCoverage: clampPercentage(
        minimum.lineCoverage,
        DEFAULT_MINIMUMS.lineCoverage,
      ),
      requirementCoverage: clampPercentage(
        minimum.requirementCoverage,
        DEFAULT_MINIMUMS.requirementCoverage,
      ),
    },
    requirements: String(config.requirements || ''),
    runTests: config.runTests !== false,
    validationCommand: (() => {
      const command = String(config.validationCommand || '').trim();
      return !command || command === LEGACY_VALIDATION_COMMAND
        ? DEFAULT_VALIDATION_COMMAND
        : command;
    })(),
    validationTimeoutMinutes: Math.min(
      120,
      Math.max(1, Number(config.validationTimeoutMinutes) || 30),
    ),
  };
}

function boundConfiguration(config: NormalizedValidatorConfig): {
  commandCanRun: boolean;
  configuredRequirementTotal: number | null;
  config: NormalizedValidatorConfig;
  reportedCommand: string;
  requirementsTruncated: boolean;
  violations: ValidationViolation[];
} {
  const violations: ValidationViolation[] = [];
  const invalidCoveragePaths =
    config.coverageSummaryPaths.length > VALIDATOR_LIMITS.coveragePathCount ||
    config.coverageSummaryPaths.some(
      (candidate) =>
        utf8Bytes(candidate) > VALIDATOR_LIMITS.coveragePathBytes ||
        !FIXED_DETAILED_COVERAGE_PATHS.has(candidate),
    );
  if (invalidCoveragePaths) {
    violations.push(
      invalidConfiguration(
        `Coverage reports are fixed to detailed artifacts at ${DEFAULT_COVERAGE_SUMMARY_PATHS.join(' or ')}; summary-only and arbitrary workspace paths cannot satisfy validation.`,
        `Configure the coverage command to emit Istanbul coverage-final JSON or LCOV DA records at ${DEFAULT_COVERAGE_SUMMARY_PATHS.join(' or ')}.`,
      ),
    );
  }

  const invalidFailOn =
    config.failOn.length > VALIDATOR_LIMITS.failOnCodeCount ||
    config.failOn.some(
      (code) => utf8Bytes(code) > VALIDATOR_LIMITS.failOnCodeBytes,
    );
  if (invalidFailOn) {
    violations.push(
      invalidConfiguration(
        `failOn must contain at most ${VALIDATOR_LIMITS.failOnCodeCount} rule IDs of at most ${VALIDATOR_LIMITS.failOnCodeBytes} UTF-8 bytes each.`,
        'Use the documented validator rule IDs and remove duplicate or oversized entries.',
      ),
    );
  }

  const requirementBytes = utf8Bytes(config.requirements);
  let configuredRequirementTotal: number | null = null;
  let boundedRequirements = '';
  let requirementsTruncated = false;
  if (requirementBytes > VALIDATOR_LIMITS.requirementSourceBytes) {
    requirementsTruncated = true;
    violations.push(
      invalidConfiguration(
        `Requirements configuration is ${requirementBytes} UTF-8 bytes; the limit is ${VALIDATOR_LIMITS.requirementSourceBytes}.`,
        'Condense the requirement list to stable IDs and short descriptions before rerunning validation.',
      ),
    );
  } else {
    const lines = config.requirements
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    configuredRequirementTotal = lines.length;
    requirementsTruncated = lines.length > VALIDATOR_LIMITS.requirementCount;
    if (requirementsTruncated) {
      violations.push(
        invalidConfiguration(
          `Requirements configuration contains ${lines.length} entries; the limit is ${VALIDATOR_LIMITS.requirementCount}.`,
          'Group or prioritize the requirements so one validation run contains at most 100 stable requirement IDs.',
        ),
      );
    }
    boundedRequirements = lines
      .slice(0, VALIDATOR_LIMITS.requirementCount)
      .join('\n');
  }

  const commandCanRun =
    utf8Bytes(config.validationCommand) <=
    VALIDATOR_LIMITS.validationCommandBytes;
  if (!commandCanRun) {
    violations.push(
      invalidConfiguration(
        `Validation command exceeds ${VALIDATOR_LIMITS.validationCommandBytes} UTF-8 bytes.`,
        'Replace the inline command with a short package script that runs coverage once with --retries=0.',
      ),
    );
  }

  return {
    commandCanRun,
    configuredRequirementTotal,
    config: {
      ...config,
      coverageSummaryPaths: invalidCoveragePaths
        ? [...DEFAULT_COVERAGE_SUMMARY_PATHS]
        : config.coverageSummaryPaths,
      failOn: invalidFailOn ? [...DEFAULT_FAIL_ON] : config.failOn,
      requirements: boundedRequirements,
      validationCommand: commandCanRun
        ? config.validationCommand
        : DEFAULT_VALIDATION_COMMAND,
    },
    reportedCommand: truncateUtf8(
      config.validationCommand,
      VALIDATOR_LIMITS.inlineCommandBytes,
    ),
    requirementsTruncated,
    violations,
  };
}

function tokenizeShellCommand(command: string): {
  hasComment: boolean;
  tokens: Array<string | null>;
  unterminatedQuote: boolean;
} {
  const tokens: Array<string | null> = [];
  let current = '';
  let hasComment = false;
  let quote: 'double' | 'single' | null = null;
  let started = false;
  const finishWord = () => {
    if (!started) return;
    tokens.push(current);
    current = '';
    started = false;
  };
  const boundary = () => {
    finishWord();
    if (tokens.at(-1) !== null) tokens.push(null);
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (quote === 'single') {
      if (character === "'") quote = null;
      else current += character;
      started = true;
      continue;
    }
    if (quote === 'double') {
      if (character === '"') {
        quote = null;
      } else if (character === '\\' && index + 1 < command.length) {
        current += command[index + 1];
        index += 1;
      } else {
        current += character;
      }
      started = true;
      continue;
    }
    if (character === "'") {
      quote = 'single';
      started = true;
      continue;
    }
    if (character === '"') {
      quote = 'double';
      started = true;
      continue;
    }
    if (character === '\\' && index + 1 < command.length) {
      current += command[index + 1];
      started = true;
      index += 1;
      continue;
    }
    if (character === '#' && !started) {
      hasComment = true;
      while (index + 1 < command.length && command[index + 1] !== '\n') {
        index += 1;
      }
      boundary();
      continue;
    }
    if (/\s/.test(character)) {
      finishWord();
      if (character === '\n' || character === '\r') boundary();
      continue;
    }
    if (/[;&|()<>]/.test(character)) {
      boundary();
      continue;
    }
    current += character;
    started = true;
  }
  finishWord();
  return { hasComment, tokens, unterminatedQuote: quote !== null };
}

const SHELL_INTERPRETERS = new Set([
  'ash',
  'bash',
  'csh',
  'dash',
  'fish',
  'ksh',
  'mksh',
  'pdksh',
  'sh',
  'tcsh',
  'zsh',
]);
const INDIRECT_COMMAND_LAUNCHERS = new Set([
  'builtin',
  'command',
  'env',
  'exec',
  'find',
  'nice',
  'nohup',
  'stdbuf',
  'timeout',
  'xargs',
]);

function commandBasename(token: string): string {
  const normalized = token.replaceAll('\\', '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase();
}

function hiddenCommandInterpreterProblem(
  tokens: Array<string | null>,
): string | null {
  const commandTokens = tokens.filter(
    (token): token is string => token !== null,
  );
  const firstExecutable = commandTokens[0]
    ? commandBasename(commandTokens[0])
    : '';
  const nestedCommands = INDIRECT_COMMAND_LAUNCHERS.has(firstExecutable)
    ? commandTokens
    : commandTokens.slice(0, 1);
  for (const token of nestedCommands) {
    const executable = commandBasename(token);
    if (
      SHELL_INTERPRETERS.has(executable) ||
      executable === 'eval' ||
      executable === 'source' ||
      executable === '.'
    ) {
      return `The validation command cannot invoke ${executable} because shell interpreters and eval can hide the authoritative Playwright retry arguments.`;
    }
  }
  if (
    INDIRECT_COMMAND_LAUNCHERS.has(firstExecutable) &&
    commandTokens.some((token) => commandBasename(token) === 'env') &&
    commandTokens.some(
      (token) => /^--split-string(?:=|$)/.test(token) || /^-S/.test(token),
    )
  ) {
    return 'The validation command cannot use env command-string splitting because it can hide the authoritative Playwright retry arguments.';
  }
  return null;
}

function staticCommandSyntaxProblem(
  command: string,
  subject = 'validation command',
): { problem: string | null; tokens: string[] } {
  const { hasComment, tokens, unterminatedQuote } =
    tokenizeShellCommand(command);
  if (hasComment) {
    return {
      problem: `The ${subject} contains a shell comment, so retry arguments cannot be verified authoritatively.`,
      tokens: [],
    };
  }
  if (tokens.includes(null)) {
    return {
      problem: `The ${subject} must be one simple command without shell control operators so retry enforcement cannot be bypassed.`,
      tokens: [],
    };
  }
  if (/[$`]/.test(command)) {
    return {
      problem: `The ${subject} cannot use shell expansion because retry enforcement must be explicit and static.`,
      tokens: [],
    };
  }
  if (unterminatedQuote) {
    return {
      problem: `The ${subject} contains an unterminated shell quote.`,
      tokens: [],
    };
  }
  const interpreterProblem = hiddenCommandInterpreterProblem(tokens);
  if (interpreterProblem) {
    return {
      problem:
        subject === 'validation command'
          ? interpreterProblem
          : interpreterProblem.replace(
              'The validation command',
              `The ${subject}`,
            ),
      tokens: [],
    };
  }
  return {
    problem: null,
    tokens: tokens.filter((token): token is string => token !== null),
  };
}

const ENVIRONMENT_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
function playwrightArguments(inputTokens: string[]): string[] | null {
  let index = 0;
  while (ENVIRONMENT_ASSIGNMENT.test(inputTokens[index] || '')) index += 1;
  const executableToken = inputTokens[index] || '';
  const executable = commandBasename(inputTokens[index] || '');
  if (executable !== 'playwright' || executableToken !== executable)
    return null;
  return inputTokens[index + 1] === 'test'
    ? inputTokens.slice(index + 2)
    : null;
}

function retryPolicyProblem(command: string): string | null {
  const outer = staticCommandSyntaxProblem(command);
  if (outer.problem) return outer.problem;
  const invocationArguments = playwrightArguments(outer.tokens);
  if (!invocationArguments) {
    return 'The validation command must directly invoke the container-owned `playwright test` CLI; repository package scripts and package-manager wrappers are not supported.';
  }
  const values: Array<string | undefined> = [];
  for (let index = 0; index < invocationArguments.length; index += 1) {
    const token = invocationArguments[index];
    if (token === '--') break;
    if (token === '--retries') {
      const next = invocationArguments[index + 1];
      values.push(next === '--' ? undefined : next);
    } else if (token.startsWith('--retries=')) {
      values.push(token.slice('--retries='.length));
    }
  }
  if (!values.length) {
    return 'The validation command does not pass an explicit --retries=0 argument.';
  }
  if (values.some((value) => value !== '0')) {
    return 'The validation command contains a missing, conflicting, or nonzero --retries argument.';
  }
  return null;
}

function configuredPlaywrightTestDirectories(root: string): Set<string> {
  const directories = new Set<string>();
  const configNames = [
    'playwright.config.cjs',
    'playwright.config.cts',
    'playwright.config.js',
    'playwright.config.mjs',
    'playwright.config.mts',
    'playwright.config.ts',
  ];
  for (const configName of configNames) {
    const configPath = path.join(root, configName);
    try {
      const stat = fs.lstatSync(configPath);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size > MAX_TEST_FILE_BYTES ||
        !resolvesInsideWorkspace(root, configPath)
      ) {
        continue;
      }
      const source = fs.readFileSync(configPath, 'utf8');
      const sourceFile = ts.createSourceFile(
        configName,
        source,
        ts.ScriptTarget.Latest,
        true,
      );
      const inspect = (node: ts.Node): void => {
        if (ts.isPropertyAssignment(node)) {
          const name = node.name;
          const isTestDirectory =
            (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) &&
            name.text === 'testDir';
          if (
            isTestDirectory &&
            (ts.isStringLiteralLike(node.initializer) ||
              ts.isNoSubstitutionTemplateLiteral(node.initializer))
          ) {
            const resolved = resolveWorkspacePath(root, node.initializer.text);
            if (resolved) directories.add(resolved);
          }
        }
        ts.forEachChild(node, inspect);
      };
      inspect(sourceFile);
    } catch {
      // The normal validation command will report config load failures. Static
      // discovery falls back to conventional Playwright test directories.
    }
  }
  return directories;
}

function coverageConfigurationFiles(root: string): string[] {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() && COVERAGE_CONFIGURATION_FILE.test(entry.name),
      )
      .map((entry) => path.join(root, entry.name))
      .filter((file) => {
        try {
          const stat = fs.lstatSync(file);
          return (
            stat.isFile() &&
            !stat.isSymbolicLink() &&
            stat.size <= MAX_TEST_FILE_BYTES &&
            resolvesInsideWorkspace(root, file)
          );
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

function collectTestFiles(directory: string): TestFileCollection {
  const files: string[] = [];
  const violations: ValidationViolation[] = [];
  let candidateFiles = 0;
  let discoveredEntries = 0;
  let stopped = false;
  let totalBytes = 0;
  const discoveryDeadline = Date.now() + MAX_TEST_DISCOVERY_DURATION_MS;
  const configuredTestDirectories =
    configuredPlaywrightTestDirectories(directory);

  const incomplete = (message: string, remediation: string, file?: string) => {
    violations.push({
      code: 'analysis_incomplete',
      ...(file ? { file: path.relative(directory, file) } : {}),
      message,
      priority: 'critical',
      remediation,
      severity: 'error',
    });
  };

  const visit = (
    currentDirectory: string,
    depth: number,
    insideTestDirectory: boolean,
  ) => {
    if (stopped) return;
    if (depth > MAX_TEST_DISCOVERY_DEPTH) {
      incomplete(
        `Test discovery exceeded the ${MAX_TEST_DISCOVERY_DEPTH}-directory depth limit.`,
        'Flatten or exclude deeply nested generated directories so the complete test suite can be inspected.',
        currentDirectory,
      );
      stopped = true;
      return;
    }
    const entries: fs.Dirent[] = [];
    let directoryHandle: fs.Dir | undefined;
    try {
      directoryHandle = fs.opendirSync(currentDirectory);
      for (;;) {
        if (Date.now() > discoveryDeadline) {
          incomplete(
            `Test discovery exceeded the ${MAX_TEST_DISCOVERY_DURATION_MS}-millisecond duration limit.`,
            'Reduce or partition generated repository content so authoritative test discovery completes promptly.',
            currentDirectory,
          );
          stopped = true;
          break;
        }
        const entry = directoryHandle.readSync();
        if (!entry) break;
        discoveredEntries += 1;
        if (discoveredEntries > MAX_TEST_DISCOVERY_ENTRIES) {
          incomplete(
            `Test discovery exceeded the ${MAX_TEST_DISCOVERY_ENTRIES}-entry traversal limit.`,
            'Exclude generated content or partition the repository so test discovery remains bounded.',
            currentDirectory,
          );
          stopped = true;
          break;
        }
        entries.push(entry);
      }
    } catch {
      incomplete(
        'A directory in the validation workspace could not be inspected.',
        'Make the repository tree readable and rerun authoritative validation.',
        currentDirectory,
      );
      stopped = true;
      return;
    } finally {
      try {
        directoryHandle?.closeSync();
      } catch {
        // The discovery result is already bounded; closing failure does not
        // make an inspected entry unsafe to analyze.
      }
    }
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (stopped) break;
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      const fullPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        visit(
          fullPath,
          depth + 1,
          insideTestDirectory ||
            TEST_DIRECTORY_NAMES.has(entry.name.toLowerCase()) ||
            configuredTestDirectories.has(path.resolve(fullPath)),
        );
      } else if (
        !entry.isFile() ||
        (!insideTestDirectory &&
          !/\.(spec|test|e2e)\.[cm]?[jt]sx?$/.test(entry.name)) ||
        !/\.[cm]?[jt]sx?$/.test(entry.name)
      )
        continue;
      else {
        candidateFiles += 1;
        if (candidateFiles > MAX_TEST_FILES) {
          incomplete(
            `Test discovery exceeded the ${MAX_TEST_FILES}-file analysis limit.`,
            'Reduce or partition the test suite so every candidate test file can be inspected in one validation run.',
          );
          stopped = true;
          break;
        }

        let size: number;
        try {
          size = fs.statSync(fullPath).size;
        } catch {
          incomplete(
            'A discovered test file could not be inspected.',
            'Make the test file readable and rerun authoritative validation.',
            fullPath,
          );
          stopped = true;
          break;
        }
        if (size > MAX_TEST_FILE_BYTES) {
          incomplete(
            `Test file exceeds the ${MAX_TEST_FILE_BYTES}-byte per-file analysis limit.`,
            'Split this test file into smaller focused specifications so the validator can inspect every test.',
            fullPath,
          );
          stopped = true;
          break;
        }
        if (totalBytes + size > MAX_TOTAL_TEST_BYTES) {
          incomplete(
            `Test sources exceed the ${MAX_TOTAL_TEST_BYTES}-byte aggregate analysis limit.`,
            'Reduce or partition the test suite so all candidate test sources fit within one validation run.',
            fullPath,
          );
          stopped = true;
          break;
        }
        totalBytes += size;

        let source: string;
        try {
          source = fs.readFileSync(fullPath, 'utf8');
        } catch {
          incomplete(
            'A discovered test file could not be read for static analysis.',
            'Make the test file readable and rerun authoritative validation.',
            fullPath,
          );
          stopped = true;
          break;
        }
        if (
          !/(?:from\s+|require\(\s*)['"](?:node:test|vitest|jest|@jest\/globals)['"]/.test(
            source,
          )
        ) {
          files.push(fullPath);
        }
      }
    }
  };
  if (configuredTestDirectories.size > 0) {
    const discoveryRoots: string[] = [];
    for (const candidate of [...configuredTestDirectories].sort(
      (left, right) => left.length - right.length || left.localeCompare(right),
    )) {
      if (
        discoveryRoots.some(
          (root) =>
            candidate === root || candidate.startsWith(`${root}${path.sep}`),
        )
      ) {
        continue;
      }
      discoveryRoots.push(candidate);
    }
    for (const testDirectory of discoveryRoots) {
      try {
        const stat = fs.lstatSync(testDirectory);
        if (
          stat.isSymbolicLink() ||
          !stat.isDirectory() ||
          !resolvesInsideWorkspace(directory, testDirectory)
        ) {
          incomplete(
            'A configured Playwright testDir is not a real directory inside the validation workspace.',
            'Point testDir at a regular directory inside the checked-out repository and rerun authoritative validation.',
            testDirectory,
          );
          stopped = true;
          break;
        }
      } catch {
        // visit() reports the configured directory as unreadable and fails
        // closed with the same bounded discovery contract.
      }
      visit(testDirectory, 0, true);
    }
  } else {
    visit(directory, 0, false);
  }
  return { files: files.sort(), violations };
}

function expressionPath(expression: ts.Expression): string[] {
  if (ts.isIdentifier(expression)) return [expression.text];
  if (ts.isPropertyAccessExpression(expression)) {
    return [...expressionPath(expression.expression), expression.name.text];
  }
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    ts.isStringLiteralLike(expression.argumentExpression)
  ) {
    return [
      ...expressionPath(expression.expression),
      expression.argumentExpression.text,
    ];
  }
  return [];
}

function sourceLocation(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  cwd: string,
): Pick<ValidationViolation, 'column' | 'file' | 'line'> {
  const location = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  return {
    column: location.character + 1,
    file: path.relative(cwd, sourceFile.fileName),
    line: location.line + 1,
  };
}

function isLiteralExpression(node: ts.Expression): boolean {
  return (
    ts.isStringLiteralLike(node) ||
    ts.isNumericLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword
  );
}

const EXPECT_MODIFIERS = new Set(['not', 'rejects', 'resolves']);
const EXPECT_FACTORIES = new Set(['poll', 'soft']);

function accessMemberName(expression: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    ts.isStringLiteralLike(expression.argumentExpression)
  ) {
    return expression.argumentExpression.text;
  }
  return null;
}

function expectMatcher(
  call: ts.CallExpression,
): { expectCall: ts.CallExpression; matcher: string } | null {
  if (
    !ts.isPropertyAccessExpression(call.expression) &&
    !ts.isElementAccessExpression(call.expression)
  ) {
    return null;
  }
  const matcher = accessMemberName(call.expression);
  if (!matcher || EXPECT_MODIFIERS.has(matcher)) return null;

  let receiver: ts.Expression = call.expression.expression;
  while (
    ts.isPropertyAccessExpression(receiver) ||
    ts.isElementAccessExpression(receiver)
  ) {
    const modifier = accessMemberName(receiver);
    if (!modifier || !EXPECT_MODIFIERS.has(modifier)) return null;
    receiver = receiver.expression;
  }
  if (!ts.isCallExpression(receiver)) return null;
  const factoryPath = expressionPath(receiver.expression);
  if (
    factoryPath[0] !== 'expect' ||
    (factoryPath.length !== 1 &&
      !(factoryPath.length === 2 && EXPECT_FACTORIES.has(factoryPath[1])))
  ) {
    return null;
  }
  return { expectCall: receiver, matcher };
}

function isTrivialExpect(
  expectCall: ts.CallExpression,
  matcherCall: ts.CallExpression,
  matcher: string,
): boolean {
  if (
    !expectCall.arguments.length ||
    !isLiteralExpression(expectCall.arguments[0])
  ) {
    return false;
  }
  const matcherArguments = matcherCall.arguments;
  if (
    ['toBeTruthy', 'toBeFalsy', 'toBeDefined', 'toBeNull'].includes(matcher)
  ) {
    return true;
  }
  if (!['toBe', 'toEqual', 'toStrictEqual'].includes(matcher)) return false;
  return (
    matcherArguments.length === 1 &&
    isLiteralExpression(matcherArguments[0]) &&
    expectCall.arguments[0].getText() === matcherArguments[0].getText()
  );
}

function collectStrings(node: ts.Node): string[] {
  const values: string[] = [];
  const visit = (candidate: ts.Node) => {
    if (ts.isStringLiteralLike(candidate)) values.push(candidate.text);
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return values;
}

function propertyName(property: ts.ObjectLiteralElementLike): string {
  if (!('name' in property) || !property.name) return '';
  return ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)
    ? property.name.text
    : property.name.getText().replace(/["']/g, '');
}

function collectRequirementEvidenceStrings(
  call: ts.CallExpression,
  callback: ts.ArrowFunction | ts.FunctionExpression | undefined,
): string[] {
  const values: string[] = [];
  const title = call.arguments[0];
  if (title && ts.isStringLiteralLike(title)) values.push(title.text);

  for (const argument of call.arguments) {
    if (!ts.isObjectLiteralExpression(argument)) continue;
    for (const property of argument.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        ['annotation', 'annotations', 'tag', 'tags'].includes(
          propertyName(property),
        )
      ) {
        values.push(...collectStrings(property.initializer));
      }
    }
  }

  if (callback) {
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const callPath = expressionPath(node.expression);
        if (callPath.includes('annotations') && callPath.at(-1) === 'push') {
          for (const argument of node.arguments) {
            values.push(...collectStrings(argument));
          }
          return;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(callback);
  }
  return Array.from(new Set(values));
}

function testTitle(call: ts.CallExpression, fallback: string): string {
  const title = call.arguments[0];
  return title && ts.isStringLiteralLike(title) ? title.text : fallback;
}

function isExpectedFailureCall(call: ts.CallExpression): boolean {
  const callPath = expressionPath(call.expression);
  return (
    callPath.length === 2 && callPath[0] === 'test' && callPath[1] === 'fail'
  );
}

function containsExpectedFailure(node: ts.Node): boolean {
  let found = false;
  const visit = (candidate: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(candidate) && isExpectedFailureCall(candidate)) {
      found = true;
      return;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return found;
}

function requiredModuleName(expression: ts.Expression): string | null {
  if (
    !ts.isCallExpression(expression) ||
    !ts.isIdentifier(expression.expression) ||
    expression.expression.text !== 'require' ||
    expression.arguments.length !== 1 ||
    !ts.isStringLiteralLike(expression.arguments[0])
  ) {
    return null;
  }
  return expression.arguments[0].text;
}

function coverageSynthesisViolation(
  file: string,
  cwd: string,
): ValidationViolation | null {
  const source = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const filesystemBindings = new Set<string>();
  const filesystemWriteBindings = new Set<string>();
  const processBindings = new Set<string>();
  let marker: ts.Node | null = null;

  const addBinding = (name: ts.BindingName, moduleName: string) => {
    const isFilesystem = FILESYSTEM_MODULES.has(moduleName);
    const isProcess = PROCESS_MODULES.has(moduleName);
    if (!isFilesystem && !isProcess) return;
    if (ts.isIdentifier(name)) {
      (isFilesystem ? filesystemBindings : processBindings).add(name.text);
      return;
    }
    for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) continue;
      if (!ts.isIdentifier(element.name)) continue;
      const importedName = element.propertyName?.getText() || element.name.text;
      if (isFilesystem && COVERAGE_WRITE_METHODS.has(importedName)) {
        filesystemWriteBindings.add(element.name.text);
      } else if (isProcess) {
        processBindings.add(element.name.text);
      }
    }
  };

  const collect = (node: ts.Node) => {
    if (
      !marker &&
      ((ts.isIdentifier(node) && COVERAGE_REPORT_MARKER.test(node.text)) ||
        (ts.isStringLiteralLike(node) &&
          COVERAGE_REPORT_MARKER.test(node.text)))
    ) {
      marker = node;
    }
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      const moduleName = node.moduleSpecifier.text;
      const clause = node.importClause;
      if (clause?.name) addBinding(clause.name, moduleName);
      if (clause?.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          addBinding(clause.namedBindings.name, moduleName);
        } else {
          for (const element of clause.namedBindings.elements) {
            const importedName =
              element.propertyName?.text || element.name.text;
            if (
              FILESYSTEM_MODULES.has(moduleName) &&
              COVERAGE_WRITE_METHODS.has(importedName)
            ) {
              filesystemWriteBindings.add(element.name.text);
            } else if (PROCESS_MODULES.has(moduleName)) {
              processBindings.add(element.name.text);
            }
          }
        }
      }
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const moduleName = requiredModuleName(node.initializer);
      if (moduleName) addBinding(node.name, moduleName);
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);

  if (!marker) return null;
  let capability: ts.Node | null = null;
  const findCapability = (node: ts.Node) => {
    if (capability) return;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      COVERAGE_REPORT_MARKER.test(node.left.getText(sourceFile))
    ) {
      capability = node;
      return;
    }
    if (ts.isCallExpression(node)) {
      const callPath = expressionPath(node.expression);
      const root = callPath[0] || '';
      const member = callPath.at(-1) || '';
      if (
        filesystemWriteBindings.has(root) ||
        (filesystemBindings.has(root) && COVERAGE_WRITE_METHODS.has(member)) ||
        ((root === 'Bun' || root === 'Deno') &&
          /^(?:write|writeFile|writeTextFile)/.test(member)) ||
        processBindings.has(root)
      ) {
        capability = node;
        return;
      }
      if (
        (ts.isPropertyAccessExpression(node.expression) ||
          ts.isElementAccessExpression(node.expression)) &&
        (() => {
          const moduleName = requiredModuleName(node.expression.expression);
          if (!moduleName) return false;
          const member = accessMemberName(node.expression);
          return (
            PROCESS_MODULES.has(moduleName) ||
            (FILESYSTEM_MODULES.has(moduleName) &&
              Boolean(member && COVERAGE_WRITE_METHODS.has(member)))
          );
        })()
      ) {
        capability = node;
        return;
      }
    }
    ts.forEachChild(node, findCapability);
  };
  findCapability(sourceFile);
  if (!capability) return null;

  return {
    code: 'coverage_artifact_synthesis',
    ...sourceLocation(sourceFile, capability, cwd),
    message:
      'Test or executable test configuration can synthesize a coverage report that the validator would otherwise inspect.',
    priority: 'critical',
    remediation:
      'Remove coverage-file writes, coverage-global mutation, and child-process report generation from tests and executable test configuration. Let the existing coverage instrumenter emit the fixed detailed report.',
    severity: 'error',
  };
}

function coverageSynthesisViolations(
  files: string[],
  cwd: string,
): ValidationViolation[] {
  const violations: ValidationViolation[] = [];
  for (const file of Array.from(
    new Set([...files, ...coverageConfigurationFiles(cwd)]),
  ).sort()) {
    try {
      const violation = coverageSynthesisViolation(file, cwd);
      if (violation) violations.push(violation);
    } catch {
      violations.push({
        code: 'analysis_incomplete',
        file: path.relative(cwd, file),
        message:
          'A test or coverage configuration file could not be inspected for coverage-report synthesis.',
        priority: 'critical',
        remediation:
          'Make every test and test configuration file readable and stable, then rerun validation.',
        severity: 'error',
      });
    }
  }
  return violations;
}

function analyzeTestFile(file: string, cwd: string): TestAnalysis {
  const source = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const tests: AnalyzedTest[] = [];
  const violations: ValidationViolation[] = [];
  let focused = 0;
  let skipped = 0;
  let testsWithMeaningfulAssertions = 0;

  const addViolation = (
    node: ts.Node,
    violation: Omit<ValidationViolation, 'column' | 'file' | 'line'>,
  ) =>
    violations.push({ ...sourceLocation(sourceFile, node, cwd), ...violation });

  const visit = (node: ts.Node, skippedByAncestor = false) => {
    if (!ts.isCallExpression(node)) {
      ts.forEachChild(node, (child) => visit(child, skippedByAncestor));
      return;
    }

    const callPath = expressionPath(node.expression);
    const root = callPath[0];
    const member = callPath[callPath.length - 1];

    if (isExpectedFailureCall(node)) {
      addViolation(node, {
        code: 'expected_failure_test',
        message:
          'Uses test.fail(), allowing an expected application failure to satisfy the test command.',
        priority: 'critical',
        remediation:
          'Remove test.fail() and make the asserted behavior pass normally before validation.',
        severity: 'error',
      });
    }

    if (member === 'waitForTimeout') {
      addViolation(node, {
        code: 'hardcoded_wait',
        message:
          'Uses waitForTimeout(), which makes the suite timing-dependent.',
        priority: 'high',
        remediation:
          'Wait for an observable UI, network, or backend-state condition instead.',
        severity: 'error',
      });
    }

    if (member === 'locator' && node.arguments[0]?.getText()) {
      const selector = ts.isStringLiteralLike(node.arguments[0])
        ? node.arguments[0].text
        : '';
      if (
        selector &&
        (/^(?:css=|xpath=|\/\/|#|\.)/.test(selector) ||
          /(?:nth-child|nth-of-type|>\s*[a-z]|\[data-(?!testid))/.test(
            selector,
          ))
      ) {
        addViolation(node, {
          code: 'weak_selector',
          message: `Uses a brittle implementation selector: ${selector}`,
          priority: 'medium',
          remediation:
            'Prefer getByRole(), getByLabel(), getByText(), or another user-facing locator.',
          severity: 'warning',
        });
      }
    }

    if (
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'configure' &&
      node.arguments.some(
        (argument) =>
          ts.isObjectLiteralExpression(argument) &&
          argument.properties.some(
            (property) =>
              ts.isPropertyAssignment(property) &&
              property.name.getText().replace(/["']/g, '') === 'retries' &&
              Number(property.initializer.getText()) > 0,
          ),
      )
    ) {
      addViolation(node, {
        code: 'retry_dependence',
        message: 'Configures retries inside the test suite.',
        priority: 'high',
        remediation:
          'Remove retry dependence and fix the observable synchronization or state isolation issue.',
        severity: 'error',
      });
    }

    if (
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'retry' &&
      ts.isIdentifier(node.expression.expression) &&
      /testInfo/i.test(node.expression.expression.text)
    ) {
      addViolation(node, {
        code: 'retry_dependence',
        message: 'Changes behavior based on the current retry number.',
        priority: 'high',
        remediation:
          'Make the test deterministic on its first execution and remove retry-specific behavior.',
        severity: 'error',
      });
    }

    const isTestCall =
      (root === 'test' || root === 'it') &&
      (callPath.length === 1 ||
        (callPath.length === 2 &&
          ['only', 'skip', 'fixme'].includes(callPath[1])));
    const isDescribeCall =
      (root === 'test' || root === 'describe') && callPath.includes('describe');
    const isFocusedDescribe = isDescribeCall && member === 'only';
    const isSkippedDescribe =
      isDescribeCall && (member === 'skip' || member === 'fixme');
    const isSkippedTest =
      isTestCall && (member === 'skip' || member === 'fixme');

    if (isFocusedDescribe || (isTestCall && member === 'only')) {
      focused += 1;
      addViolation(node, {
        code: 'focused_test',
        message:
          'Contains .only and would exclude other tests from validation.',
        priority: 'critical',
        remediation: 'Remove .only before the suite is accepted.',
        severity: 'error',
      });
    }

    if (isSkippedDescribe || isSkippedTest) {
      addViolation(node, {
        code: 'skipped_test',
        message: `Contains a skipped or fixme ${isSkippedDescribe ? 'suite' : 'test'}.`,
        priority: 'high',
        remediation:
          'Implement and enable the behavior, or remove it from the required validation scope.',
        severity: 'error',
      });
    }

    if (isTestCall) {
      const testSkipped = skippedByAncestor || isSkippedTest;
      const callback = node.arguments.find(
        (argument) =>
          ts.isArrowFunction(argument) || ts.isFunctionExpression(argument),
      );
      const expectedFailure = callback
        ? containsExpectedFailure(callback)
        : false;
      const fallbackTitle = `test at ${sourceLocation(sourceFile, node, cwd).line}`;
      const analyzedTest: AnalyzedTest = {
        expectedFailure,
        file: path.relative(cwd, file),
        line: sourceLocation(sourceFile, node, cwd).line || 1,
        meaningfulAssertion: false,
        skipped: testSkipped,
        strings: collectRequirementEvidenceStrings(node, callback),
        title: truncateUtf8(
          testTitle(node, fallbackTitle),
          VALIDATOR_LIMITS.testTitleBytes,
        ),
      };
      tests.push(analyzedTest);
      if (testSkipped) skipped += 1;

      if (!testSkipped && !expectedFailure) {
        let assertionCount = 0;
        let trivialAssertionCount = 0;
        if (callback) {
          const inspectTestBody = (candidate: ts.Node) => {
            if (ts.isCallExpression(candidate)) {
              const assertionPath = expressionPath(candidate.expression);
              const matcher = expectMatcher(candidate);
              if (
                matcher ||
                (assertionPath[0] === 'assert' && assertionPath.length > 1)
              ) {
                assertionCount += 1;
                if (
                  matcher &&
                  isTrivialExpect(
                    matcher.expectCall,
                    candidate,
                    matcher.matcher,
                  )
                ) {
                  trivialAssertionCount += 1;
                  addViolation(candidate, {
                    code: 'trivial_assertion',
                    message: `Test “${analyzedTest.title}” contains an assertion that proves only a literal value.`,
                    priority: 'high',
                    remediation:
                      'Assert observable application behavior or backend state produced by the test action.',
                    severity: 'error',
                  });
                }
              }
            }
            ts.forEachChild(candidate, inspectTestBody);
          };
          inspectTestBody(callback);
        }

        if (!callback) {
          addViolation(node, {
            code: 'unresolved_test_body',
            message: `Test “${analyzedTest.title}” uses a callback that cannot be inspected statically.`,
            priority: 'low',
            remediation:
              'Use an inline test callback or ensure the configured assertion threshold accounts for helper-based tests.',
            severity: 'warning',
          });
        } else if (assertionCount === 0) {
          addViolation(node, {
            code: 'zero_assertion_test',
            message: `Test “${analyzedTest.title}” contains no observable assertion.`,
            priority: 'high',
            remediation:
              'Add an expect() or assert.* check for the behavior the test is intended to prove.',
            severity: 'error',
          });
        } else if (assertionCount > trivialAssertionCount) {
          analyzedTest.meaningfulAssertion = true;
          testsWithMeaningfulAssertions += 1;
        }
      }
    }

    const descendantsSkipped = skippedByAncestor || isSkippedDescribe;
    ts.forEachChild(node, (child) => visit(child, descendantsSkipped));
  };

  visit(sourceFile);
  return {
    focused,
    skipped,
    tests,
    testsWithMeaningfulAssertions,
    violations,
  };
}

function analyzeTests(files: string[], cwd: string): TestAnalysis {
  return files.reduce<TestAnalysis>(
    (result, file) => {
      try {
        const analysis = analyzeTestFile(file, cwd);
        result.focused += analysis.focused;
        result.skipped += analysis.skipped;
        result.tests.push(...analysis.tests);
        result.testsWithMeaningfulAssertions +=
          analysis.testsWithMeaningfulAssertions;
        result.violations.push(...analysis.violations);
      } catch {
        result.violations.push({
          code: 'analysis_incomplete',
          file: path.relative(cwd, file),
          message: 'A test file changed or became unreadable during analysis.',
          priority: 'critical',
          remediation:
            'Stop processes that mutate test sources, make the file readable, and rerun authoritative validation.',
          severity: 'error',
        });
      }
      return result;
    },
    {
      focused: 0,
      skipped: 0,
      tests: [],
      testsWithMeaningfulAssertions: 0,
      violations: [],
    },
  );
}

function percentage(covered: number, total: number): number {
  return total > 0 ? (covered / total) * 100 : 100;
}

function normalizeCoverageFilePath(
  cwd: string,
  repositoryRoot: string,
  file: string,
): string {
  const absolute = path.isAbsolute(file) ? file : path.resolve(cwd, file);
  const relative = path.relative(repositoryRoot, absolute);
  return relative.replace(/\\/g, '/').replace(/^\.\//, '');
}

function parseCoverageFinal(
  parsed: Record<string, any>,
  cwd: string,
  repositoryRoot: string,
): Omit<CoverageResult, 'sourcePath'> {
  let totalLines = 0;
  let coveredLines = 0;
  let totalBranches = 0;
  let coveredBranches = 0;
  let hasBranchMeasurement = false;
  const files: CoverageFile[] = [];

  for (const [file, coverage] of Object.entries(parsed) as Array<
    [string, any]
  >) {
    const lineHits = new Map<number, number>();
    for (const [statementId, count] of Object.entries(coverage.s || {})) {
      const line = Number(coverage.statementMap?.[statementId]?.start?.line);
      if (Number.isFinite(line)) {
        lineHits.set(
          line,
          Math.max(lineHits.get(line) || 0, Number(count) || 0),
        );
      }
    }
    const measuredBranches =
      coverage.b &&
      typeof coverage.b === 'object' &&
      !Array.isArray(coverage.b);
    const branchHits = measuredBranches
      ? Object.values(coverage.b).flatMap((counts: any) =>
          Array.isArray(counts) ? counts.map(Number) : [],
        )
      : [];
    hasBranchMeasurement ||= measuredBranches;
    const fileLines = lineHits.size;
    const fileCoveredLines = [...lineHits.values()].filter(
      (count) => count > 0,
    ).length;
    const fileBranches = branchHits.length;
    const fileCoveredBranches = branchHits.filter((count) => count > 0).length;
    totalLines += fileLines;
    coveredLines += fileCoveredLines;
    totalBranches += fileBranches;
    coveredBranches += fileCoveredBranches;
    files.push({
      branchCoverage: measuredBranches
        ? percentage(fileCoveredBranches, fileBranches)
        : null,
      file: normalizeCoverageFilePath(cwd, repositoryRoot, file),
      lineHits,
      lineCoverage: percentage(fileCoveredLines, fileLines),
    });
  }

  if (!files.length || totalLines === 0) {
    throw new Error('Istanbul coverage contains no measured source lines.');
  }

  return {
    branchCoverage: hasBranchMeasurement
      ? percentage(coveredBranches, totalBranches)
      : null,
    detailedLines: true,
    files,
    lineCoverage: percentage(coveredLines, totalLines),
  };
}

function parseLcov(
  source: string,
  cwd: string,
  repositoryRoot: string,
): Omit<CoverageResult, 'sourcePath'> {
  const records = source.split(/\bend_of_record\s*/);
  const files: CoverageFile[] = [];
  let totalLines = 0;
  let coveredLines = 0;
  let totalBranches = 0;
  let coveredBranches = 0;
  let hasBranchMeasurement = false;
  for (const record of records) {
    const file = record.match(/^SF:(.+)$/m)?.[1]?.trim();
    if (!file) continue;
    const lineTotal = Number(record.match(/^LF:(\d+)$/m)?.[1] || 0);
    const lineCovered = Number(record.match(/^LH:(\d+)$/m)?.[1] || 0);
    const lineHits = new Map<number, number>();
    for (const match of record.matchAll(/^DA:(\d+),(\d+)(?:,.*)?$/gm)) {
      const line = Number(match[1]);
      const hits = Number(match[2]);
      if (Number.isSafeInteger(line) && line > 0 && Number.isFinite(hits)) {
        lineHits.set(line, Math.max(lineHits.get(line) || 0, hits));
      }
    }
    if (
      lineHits.size > 0 &&
      (lineTotal !== lineHits.size ||
        lineCovered !==
          [...lineHits.values()].filter((hits) => hits > 0).length)
    ) {
      throw new Error(
        `LCOV aggregate line counts do not match DA records for ${file}.`,
      );
    }
    const branchTotalMatch = record.match(/^BRF:(\d+)$/m);
    const branchCoveredMatch = record.match(/^BRH:(\d+)$/m);
    if (Boolean(branchTotalMatch) !== Boolean(branchCoveredMatch)) {
      throw new Error(`LCOV contains incomplete branch counts for ${file}.`);
    }
    const measuredBranches = Boolean(branchTotalMatch && branchCoveredMatch);
    const branchTotal = Number(branchTotalMatch?.[1] || 0);
    const branchCovered = Number(branchCoveredMatch?.[1] || 0);
    if (lineCovered > lineTotal || branchCovered > branchTotal) {
      throw new Error(
        `LCOV contains invalid covered/total counts for ${file}.`,
      );
    }
    totalLines += lineTotal;
    coveredLines += lineCovered;
    totalBranches += branchTotal;
    coveredBranches += branchCovered;
    hasBranchMeasurement ||= measuredBranches;
    files.push({
      branchCoverage: measuredBranches
        ? percentage(branchCovered, branchTotal)
        : null,
      file: normalizeCoverageFilePath(cwd, repositoryRoot, file),
      lineHits: lineHits.size || lineTotal === 0 ? lineHits : null,
      lineCoverage: percentage(lineCovered, lineTotal),
    });
  }
  if (!files.length) throw new Error('LCOV contains no file records.');
  if (totalLines === 0) throw new Error('LCOV contains no measured lines.');
  return {
    branchCoverage: hasBranchMeasurement
      ? percentage(coveredBranches, totalBranches)
      : null,
    detailedLines: files.some((file) => file.lineHits !== null),
    files,
    lineCoverage: percentage(coveredLines, totalLines),
  };
}

function resolveWorkspacePath(cwd: string, candidate: string): string | null {
  const resolved = path.resolve(cwd, candidate);
  return resolved === cwd || resolved.startsWith(`${cwd}${path.sep}`)
    ? resolved
    : null;
}

function resolvesInsideWorkspace(cwd: string, target: string): boolean {
  try {
    const realRoot = fs.realpathSync(cwd);
    const realTarget = fs.realpathSync(target);
    return (
      realTarget === realRoot || realTarget.startsWith(`${realRoot}${path.sep}`)
    );
  } catch {
    return false;
  }
}

function coveragePathContainsSymbolicLink(
  cwd: string,
  target: string,
): boolean {
  const relative = path.relative(cwd, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return relative !== '';
  }
  let current = cwd;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (fs.lstatSync(current).isSymbolicLink()) return true;
  }
  return false;
}

function resolveRepositoryRoot(
  cwd: string,
  configuredRoot: string | undefined,
  violations: ValidationViolation[],
): string {
  const rootPath = path.resolve(configuredRoot || cwd);
  try {
    const realCwd = fs.realpathSync(cwd);
    const root = fs.realpathSync(rootPath);
    if (realCwd === root || realCwd.startsWith(`${root}${path.sep}`)) {
      return rootPath;
    }
  } catch {
    // Report the trusted-context failure below.
  }
  violations.push({
    code: 'invalid_change_manifest',
    message:
      'The validator repository root does not contain its working directory.',
    priority: 'critical',
    remediation:
      'Regenerate the trusted repository context before running changed-code validation.',
    severity: 'error',
  });
  return path.resolve(cwd);
}

function unsafeCoveragePathViolation(
  cwd: string,
  candidate: string,
  resolved: string,
): ValidationViolation | null {
  if (
    coveragePathContainsSymbolicLink(cwd, resolved) ||
    !resolvesInsideWorkspace(cwd, resolved)
  ) {
    return {
      code: 'coverage_path_outside_workspace',
      file: path.relative(cwd, resolved),
      message: `Coverage path resolves through a symbolic link or outside the checked-out repository: ${candidate}`,
      priority: 'high',
      remediation:
        'Generate a regular coverage artifact file inside the checked-out repository.',
      severity: 'error',
    };
  }
  return null;
}

function readCoverage(
  cwd: string,
  repositoryRoot: string,
  candidates: string[],
  violations: ValidationViolation[],
): CoverageResult {
  for (const candidate of candidates) {
    const resolved = resolveWorkspacePath(cwd, candidate);
    if (!resolved) {
      violations.push({
        code: 'coverage_path_outside_workspace',
        message: `Coverage path is outside the checked-out repository: ${candidate}`,
        priority: 'high',
        remediation:
          'Configure a coverage artifact path inside the repository.',
        severity: 'error',
      });
      continue;
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) continue;
    const unsafePath = unsafeCoveragePathViolation(cwd, candidate, resolved);
    if (unsafePath) {
      violations.push(unsafePath);
      continue;
    }
    if (fs.statSync(resolved).size > MAX_COVERAGE_ARTIFACT_BYTES) {
      violations.push({
        code: 'invalid_coverage_artifact',
        file: path.relative(cwd, resolved),
        message: `Coverage artifact exceeds ${MAX_COVERAGE_ARTIFACT_BYTES} bytes.`,
        priority: 'high',
        remediation:
          'Generate a compact Istanbul coverage-final JSON file or LCOV report with detailed line records.',
        severity: 'error',
      });
      continue;
    }
    try {
      const source = fs.readFileSync(resolved, 'utf8');
      const coverage = resolved.endsWith('.info')
        ? parseLcov(source, cwd, repositoryRoot)
        : parseCoverageFinal(
            JSON.parse(source) as Record<string, any>,
            cwd,
            repositoryRoot,
          );
      if (!coverage.detailedLines) {
        throw new Error(
          'Coverage contains aggregate totals only; detailed Istanbul statement locations or LCOV DA records are required.',
        );
      }
      const result = {
        ...coverage,
        sourcePath: path.relative(cwd, resolved),
      };
      return result;
    } catch (error) {
      violations.push({
        code: 'invalid_coverage_artifact',
        file: path.relative(cwd, resolved),
        message: `Could not parse coverage artifact: ${error instanceof Error ? error.message : String(error)}`,
        priority: 'high',
        remediation:
          'Generate a valid Istanbul coverage-final JSON file or LCOV report with DA line records.',
        severity: 'error',
      });
    }
  }
  return {
    branchCoverage: null,
    detailedLines: false,
    files: [],
    lineCoverage: null,
  };
}

function removeStaleCoverageArtifacts(
  cwd: string,
  candidates: string[],
  violations: ValidationViolation[],
) {
  for (const candidate of candidates) {
    const resolved = resolveWorkspacePath(cwd, candidate);
    if (!resolved || !fs.existsSync(resolved)) continue;
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink()) {
      fs.rmSync(resolved, { force: true });
      continue;
    }
    const unsafePath = unsafeCoveragePathViolation(cwd, candidate, resolved);
    if (unsafePath) {
      violations.push(unsafePath);
      continue;
    }
    if (stat.isFile()) fs.rmSync(resolved, { force: true });
  }
  for (const directory of ['playwright-report', 'test-results']) {
    const target = path.join(cwd, directory);
    if (fs.existsSync(target)) {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) fs.rmSync(target, { force: true });
      else if (resolvesInsideWorkspace(cwd, target)) {
        fs.rmSync(target, { force: true, recursive: true });
      }
    }
  }
}

function isRequirementTokenCharacter(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9_-]/.test(value);
}

function containsRequirementId(value: string, requirementId: string): boolean {
  const source = value.toLowerCase();
  const expected = requirementId.toLowerCase();
  let offset = 0;
  while (offset <= source.length - expected.length) {
    const index = source.indexOf(expected, offset);
    if (index < 0) return false;
    const before = index > 0 ? source[index - 1] : undefined;
    const after = source[index + expected.length];
    if (
      !isRequirementTokenCharacter(before) &&
      !isRequirementTokenCharacter(after)
    ) {
      return true;
    }
    offset = index + Math.max(1, expected.length);
  }
  return false;
}

function parseRequirements(
  source: string,
  tests: AnalyzedTest[],
  violations: ValidationViolation[],
): RequirementEvidence[] {
  const seen = new Set<string>();
  const requirements: RequirementEvidence[] = [];
  let remainingEvidence = VALIDATOR_LIMITS.requirementEvidenceTotal;
  for (const [lineIndex, rawLine] of source.split(/\r?\n/).entries()) {
    let line = rawLine.trim();
    if (!line) continue;
    const critical = /^\[critical\]\s*/i.test(line);
    line = line.replace(/^\[critical\]\s*/i, '');
    const separator = line.indexOf(':');
    const rawId = (
      separator >= 0 ? line.slice(0, separator) : line.split(/\s+/, 1)[0]
    )
      .trim()
      .replace(/\s+\[critical\]$/i, '');
    const rawDescription =
      (separator >= 0 ? line.slice(separator + 1) : line).trim() || rawId;
    const idTooLong = utf8Bytes(rawId) > VALIDATOR_LIMITS.requirementIdBytes;
    const descriptionTooLong =
      utf8Bytes(rawDescription) > VALIDATOR_LIMITS.requirementDescriptionBytes;
    if (idTooLong || descriptionTooLong) {
      violations.push(
        invalidConfiguration(
          `Requirement entry ${lineIndex + 1} exceeds the ${idTooLong ? `${VALIDATOR_LIMITS.requirementIdBytes}-byte ID` : `${VALIDATOR_LIMITS.requirementDescriptionBytes}-byte description`} limit.`,
          'Shorten this requirement ID or description and rerun validation.',
        ),
      );
    }
    const id = truncateUtf8(rawId, VALIDATOR_LIMITS.requirementIdBytes);
    const description = truncateUtf8(
      rawDescription,
      VALIDATOR_LIMITS.requirementDescriptionBytes,
    );
    const normalizedId = rawId.toLowerCase();
    if (!rawId || rawId.length < 2) {
      violations.push(
        invalidConfiguration(
          `Requirement entry ${lineIndex + 1} must begin with a stable ID of at least two characters before its description.`,
          'Use a stable requirement ID such as REQ-1 followed by a colon and description.',
        ),
      );
      continue;
    }
    if (seen.has(normalizedId)) {
      violations.push({
        code: 'duplicate_requirement',
        message: `Requirement ${id} is configured more than once.`,
        priority: 'medium',
        remediation: 'Keep one canonical requirement entry for each stable ID.',
        severity: 'warning',
      });
      continue;
    }
    seen.add(normalizedId);
    const matchingTests = tests.filter(
      (test) =>
        !test.skipped &&
        !test.expectedFailure &&
        test.meaningfulAssertion &&
        test.strings.some((value) => containsRequirementId(value, rawId)),
    );
    const evidenceLimit = Math.min(
      VALIDATOR_LIMITS.requirementEvidencePerItem,
      remainingEvidence,
    );
    const evidence = matchingTests.slice(0, evidenceLimit).map((test) => ({
      file: truncateUtf8(test.file, VALIDATOR_LIMITS.violationFileBytes),
      line: test.line,
      test: test.title,
    }));
    remainingEvidence -= evidence.length;
    const evidenceTruncated = matchingTests.length > evidence.length;
    requirements.push({
      critical,
      description,
      evidence,
      ...(evidenceTruncated
        ? {
            evidenceTotal: matchingTests.length,
            evidenceTruncated: true,
          }
        : {}),
      id,
      passed: matchingTests.length > 0,
    });
  }
  return requirements;
}

function thresholdResult(
  observed: number | null,
  minimum: number,
): ValidationDimension {
  return {
    minimum,
    observed,
    passed: minimum === 0 || (observed != null && observed >= minimum),
  };
}

function thresholdViolation(
  dimension: ValidationDimension,
  label: string,
  code: string,
  missingRemediation: string,
  belowMinimumRemediation?: string,
): ValidationViolation | null {
  if (dimension.passed) return null;
  if (dimension.observed == null) {
    return {
      code,
      message: `${label} requires ${dimension.minimum}%, but the clean validation run produced no result.`,
      priority: 'critical',
      remediation: missingRemediation,
      severity: 'error',
    };
  }
  return {
    code,
    message: `${label} is ${dimension.observed.toFixed(1)}%; required minimum is ${dimension.minimum}%.`,
    priority: 'high',
    remediation:
      belowMinimumRemediation ||
      `Add meaningful tests for the uncovered ${label.toLowerCase()} paths and regenerate coverage.`,
    severity: 'error',
  };
}

function outputTail(value: string, maximumBytes = 6_000): string {
  if (utf8Bytes(value) <= maximumBytes) return value;
  const marker = '[truncated]\n';
  const available = Math.max(0, maximumBytes - utf8Bytes(marker));
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (utf8Bytes(value.slice(middle)) <= available) high = middle;
    else low = middle + 1;
  }
  return `${marker}${value.slice(low)}`;
}

function failedTestNames(output: string): string[] {
  const names = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        /^\d+\)/.test(line) ||
        /(?:›|>)\s+.+(?:\.spec|\.test)\.[cm]?[jt]sx?/i.test(line),
    )
    .map((line) =>
      truncateUtf8(
        line.replace(/^\d+\)\s*/, ''),
        VALIDATOR_LIMITS.failedTestNameBytes,
      ),
    );
  return Array.from(new Set(names)).slice(0, VALIDATOR_LIMITS.failedTestCount);
}

function lowestCoverageFiles(
  files: CoverageFile[],
  metric: 'branchCoverage' | 'lineCoverage',
): string[] {
  return files
    .filter((file) => file[metric] !== null)
    .sort((left, right) => (left[metric] ?? 101) - (right[metric] ?? 101))
    .slice(0, 5)
    .map(
      (item) =>
        `${truncateUtf8(item.file, VALIDATOR_LIMITS.violationFileBytes)} (${item.lineCoverage?.toFixed(1) ?? 'n/a'}% lines, ${item.branchCoverage?.toFixed(1) ?? 'n/a'}% branches)`,
    );
}

function changedCoverageAnalysis(
  manifest: ChangeManifest | undefined,
  coverage: CoverageResult,
): ChangedCoverageAnalysis {
  const detailedCoveragePaths = new Set(
    coverage.files
      .filter((file) => file.lineHits !== null)
      .map((file) => file.file),
  );
  const productionFiles = (manifest?.files || []).filter(
    (file) =>
      file.classification === 'production' &&
      file.status !== 'deleted' &&
      !file.binary &&
      (detailedCoveragePaths.has(file.path) ||
        EXECUTABLE_SOURCE_EXTENSIONS.has(
          path.posix.extname(file.path).toLowerCase(),
        )),
  );
  const applicable = Boolean(manifest) && productionFiles.length > 0;
  const violations: ValidationViolation[] = [];
  if (!applicable) {
    return {
      applicable: false,
      complete: true,
      coveredLines: 0,
      instrumentedFiles: 0,
      missingFiles: [],
      observed: null,
      productionFiles: 0,
      totalLines: 0,
      truncated: false,
      uncovered: [],
      violations,
    };
  }

  const coverageByFile = new Map(
    coverage.files.map((file) => [file.file, file] as const),
  );
  const missingFiles: string[] = [];
  const uncovered: ChangedCoverageAnalysis['uncovered'] = [];
  let coveredLines = 0;
  let instrumentedFiles = 0;
  let measuredLines = 0;
  let rangesSeen = 0;
  let changedLinesSeen = 0;
  let invalidOrOversized =
    productionFiles.length > VALIDATOR_LIMITS.changedCoverageFiles;
  let outputTruncated = false;

  for (const changedFile of productionFiles.slice(
    0,
    VALIDATOR_LIMITS.changedCoverageFiles,
  )) {
    const changedLines = new Set<number>();
    for (const range of changedFile.changedLines) {
      rangesSeen += 1;
      if (
        rangesSeen > VALIDATOR_LIMITS.changedCoverageRanges ||
        !Number.isSafeInteger(range.start) ||
        !Number.isSafeInteger(range.end) ||
        range.start < 1 ||
        range.end < range.start
      ) {
        invalidOrOversized = true;
        break;
      }
      for (let line = range.start; line <= range.end; line += 1) {
        changedLines.add(line);
        changedLinesSeen += 1;
        if (changedLinesSeen > VALIDATOR_LIMITS.changedCoverageLines) {
          invalidOrOversized = true;
          break;
        }
      }
      if (invalidOrOversized) break;
    }
    if (invalidOrOversized) break;

    const file = coverageByFile.get(changedFile.path);
    if (!file?.lineHits) {
      missingFiles.push(changedFile.path);
      continue;
    }
    instrumentedFiles += 1;
    const uncoveredLines: number[] = [];
    for (const line of changedLines) {
      const hits = file.lineHits.get(line);
      if (hits === undefined) continue;
      measuredLines += 1;
      if (hits > 0) coveredLines += 1;
      else uncoveredLines.push(line);
    }
    if (uncoveredLines.length) {
      const reportedLines = uncoveredLines.slice(
        0,
        VALIDATOR_LIMITS.changedCoverageReportedLinesPerFile,
      );
      const truncated = reportedLines.length < uncoveredLines.length;
      outputTruncated ||= truncated;
      if (uncovered.length < VALIDATOR_LIMITS.changedCoverageReportedFiles) {
        uncovered.push({
          file: changedFile.path,
          lines: reportedLines,
          total: uncoveredLines.length,
          truncated,
        });
      } else {
        outputTruncated = true;
      }
    }
  }

  if (invalidOrOversized) {
    violations.push({
      code: 'invalid_change_manifest',
      message: `The CI change manifest exceeds the validator limit or contains an invalid changed-line range (maximum ${VALIDATOR_LIMITS.changedCoverageFiles} files, ${VALIDATOR_LIMITS.changedCoverageRanges} ranges, and ${VALIDATOR_LIMITS.changedCoverageLines} changed lines).`,
      priority: 'critical',
      remediation:
        'Split the change into a smaller commit or regenerate the trusted CI change manifest.',
      severity: 'error',
    });
  }

  if (missingFiles.length) {
    const reported = missingFiles
      .slice(0, VALIDATOR_LIMITS.changedCoverageReportedFiles)
      .map((file) => truncateUtf8(file, VALIDATOR_LIMITS.violationFileBytes));
    outputTruncated ||= reported.length < missingFiles.length;
    violations.push({
      code: 'changed_coverage_incomplete',
      message: `Detailed line coverage is missing for ${missingFiles.length} changed production file${missingFiles.length === 1 ? '' : 's'}: ${reported.join(', ')}${reported.length < missingFiles.length ? ', …' : ''}`,
      priority: 'critical',
      remediation:
        'Instrument every changed production file and emit Istanbul coverage-final.json or LCOV with DA line records.',
      severity: 'error',
    });
  }

  const complete = !invalidOrOversized && missingFiles.length === 0;
  return {
    applicable: true,
    complete,
    coveredLines,
    instrumentedFiles,
    missingFiles: missingFiles
      .slice(0, VALIDATOR_LIMITS.changedCoverageReportedFiles)
      .map((file) => truncateUtf8(file, VALIDATOR_LIMITS.violationFileBytes)),
    observed: complete ? percentage(coveredLines, measuredLines) : null,
    productionFiles: productionFiles.length,
    totalLines: measuredLines,
    truncated: outputTruncated || invalidOrOversized,
    uncovered,
    violations,
  };
}

function findTraces(directory: string, root: string, limit = 20): string[] {
  if (!fs.existsSync(directory) || limit <= 0) return [];
  const traces: string[] = [];
  const pending = [{ depth: 0, directory }];
  const deadline = Date.now() + MAX_TRACE_DISCOVERY_DURATION_MS;
  let visitedEntries = 0;

  while (
    pending.length &&
    traces.length < limit &&
    visitedEntries < MAX_TRACE_DISCOVERY_ENTRIES &&
    Date.now() <= deadline
  ) {
    const current = pending.shift()!;
    let currentStat: fs.Stats;
    try {
      currentStat = fs.lstatSync(current.directory);
    } catch {
      continue;
    }
    if (
      !currentStat.isDirectory() ||
      currentStat.isSymbolicLink() ||
      !resolvesInsideWorkspace(root, current.directory)
    ) {
      continue;
    }

    const entries: fs.Dirent[] = [];
    let directoryHandle: fs.Dir | undefined;
    try {
      directoryHandle = fs.opendirSync(current.directory);
      for (;;) {
        if (
          visitedEntries >= MAX_TRACE_DISCOVERY_ENTRIES ||
          Date.now() > deadline
        ) {
          break;
        }
        const entry = directoryHandle.readSync();
        if (!entry) break;
        visitedEntries += 1;
        entries.push(entry);
      }
    } catch {
      continue;
    } finally {
      try {
        directoryHandle?.closeSync();
      } catch {
        // Trace references are optional; ignore cleanup errors and return the
        // bounded set already discovered.
      }
    }

    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (traces.length >= limit || Date.now() > deadline) break;
      const target = path.join(current.directory, entry.name);
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(target);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink() || !resolvesInsideWorkspace(root, target)) {
        continue;
      }
      if (stat.isDirectory() && current.depth < MAX_TRACE_DISCOVERY_DEPTH) {
        pending.push({ depth: current.depth + 1, directory: target });
      } else if (stat.isFile() && /trace.*\.zip$/i.test(entry.name)) {
        traces.push(
          truncateUtf8(
            path.relative(root, target),
            VALIDATOR_LIMITS.violationFileBytes,
          ),
        );
      }
    }
  }
  return traces.sort();
}

function deduplicateViolations(
  violations: ValidationViolation[],
): ValidationViolation[] {
  const seen = new Set<string>();
  return violations.filter((violation) => {
    const key = [
      violation.code,
      violation.file || '',
      violation.line || '',
      violation.message,
    ].join(':');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function boundedViolation(violation: ValidationViolation): ValidationViolation {
  return {
    ...violation,
    code: truncateUtf8(violation.code, VALIDATOR_LIMITS.violationCodeBytes),
    ...(violation.file
      ? {
          file: truncateUtf8(
            violation.file,
            VALIDATOR_LIMITS.violationFileBytes,
          ),
        }
      : {}),
    message: truncateUtf8(
      violation.message,
      VALIDATOR_LIMITS.violationMessageBytes,
    ),
    remediation: truncateUtf8(
      violation.remediation,
      VALIDATOR_LIMITS.violationRemediationBytes,
    ),
  };
}

function feedbackFor(violations: ValidationViolation[]) {
  const sorted = [...violations]
    .sort(
      (left, right) =>
        PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority],
    )
    .slice(0, MAX_FEEDBACK_ITEMS);
  const items = sorted.map((candidate) => {
    const violation = boundedViolation(candidate);
    return {
      code: violation.code,
      ...(violation.file
        ? {
            location: `${violation.file}${violation.line ? `:${violation.line}${violation.column ? `:${violation.column}` : ''}` : ''}`,
          }
        : {}),
      message: violation.message,
      priority: violation.priority,
      remediation: violation.remediation,
    };
  });
  const summary = items.length
    ? `Validation failed with ${violations.length} blocking finding${violations.length === 1 ? '' : 's'}${violations.length > items.length ? `; showing the first ${items.length}` : ''}.`
    : 'Validation passed.';
  const unboundedFeedbackText = items.length
    ? `${summary}\n${items
        .map(
          (item, index) =>
            `${index + 1}. [${item.code}]${item.location ? ` ${item.location}` : ''}: ${item.message}\n   Fix: ${item.remediation}`,
        )
        .join('\n')}`
    : summary;
  const feedbackText = truncateUtf8(
    unboundedFeedbackText,
    VALIDATOR_LIMITS.feedbackTextBytes,
  );
  return {
    feedback: {
      items,
      reported: items.length,
      summary,
      total: violations.length,
      truncated: violations.length > items.length,
    },
    feedbackText,
  };
}

function inlineResultBytes(result: ValidationResult): number {
  return utf8Bytes(JSON.stringify(result, null, 2));
}

function enforceInlineResultLimit(result: ValidationResult) {
  const exceedsLimit = () =>
    inlineResultBytes(result) >= VALIDATOR_LIMITS.inlineResultBytes;

  while (exceedsLimit() && result.violations.length > 1) {
    result.violations = result.violations.slice(
      0,
      Math.floor(result.violations.length / 2),
    );
    if (result.violationSummary) {
      result.violationSummary.reported = result.violations.length;
      result.violationSummary.truncated = true;
    }
  }

  if (exceedsLimit() && result.feedback.items.length) {
    const total = result.feedback.total ?? result.feedback.items.length;
    result.feedback.items = [];
    result.feedback.reported = 0;
    result.feedback.truncated = total > 0;
    result.feedback.summary = `Validation failed with ${total} blocking finding${total === 1 ? '' : 's'}; inline details omitted because the report reached its size limit.`;
    result.feedbackText = result.feedback.summary;
  }

  if (exceedsLimit()) {
    for (const requirement of result.requirements.items) {
      if (!requirement.evidence.length) continue;
      requirement.evidenceTotal ??= requirement.evidence.length;
      requirement.evidence = [];
      requirement.evidenceTruncated = true;
    }
  }

  if (exceedsLimit() && result.requirements.items.length) {
    result.requirements.items = [];
    result.requirements.reported = 0;
    result.requirements.truncated = true;
  }

  if (exceedsLimit()) {
    result.testRun.command = result.testRun.command
      ? truncateUtf8(result.testRun.command, 256)
      : null;
    result.testRun.failedTests = [];
    result.testRun.stderrTail = '';
    result.testRun.stdoutTail = '';
    result.artifacts.traces = [];
  }

  if (exceedsLimit()) {
    result.violations = [];
    if (result.violationSummary) {
      result.violationSummary.reported = 0;
      result.violationSummary.truncated = result.violationSummary.total > 0;
    }
  }
}

async function defaultRunCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
) {
  return runProcess('/bin/sh', ['-c', command], {
    cwd,
    env: process.env,
    maxOutputBytes: 1_000_000,
    stream: true,
    timeoutMs,
  });
}

export async function validatePlaywrightTests(
  cwd: string,
  inputConfig: ValidatorConfig,
  options: ValidatorOptions = {},
): Promise<ValidationResult> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const configuration = boundConfiguration(normalizeConfig(inputConfig));
  const config = configuration.config;
  const authoritative = options.authoritative === true;
  const violations: ValidationViolation[] = [...configuration.violations];

  const retryProblem =
    config.runTests && configuration.commandCanRun
      ? retryPolicyProblem(config.validationCommand)
      : null;
  const commandCanRun = configuration.commandCanRun && !retryProblem;
  if (retryProblem) {
    violations.push({
      code: 'retry_policy_not_enforced',
      message: retryProblem,
      priority: 'critical',
      remediation:
        'Add --retries=0 to the configured validation command so flaky retries cannot satisfy the quality gate.',
      severity: 'error',
    });
  }

  if (authoritative) {
    removeStaleCoverageArtifacts(cwd, config.coverageSummaryPaths, violations);
  }

  const validationTimeoutMs = Math.max(
    1,
    Math.min(
      config.validationTimeoutMinutes * 60_000,
      options.timeoutMs ?? Number.POSITIVE_INFINITY,
    ),
  );
  const testRunResult =
    config.runTests && commandCanRun
      ? await (options.runCommand || defaultRunCommand)(
          config.validationCommand,
          cwd,
          validationTimeoutMs,
        )
      : {
          code: 0,
          durationMs: 0,
          signal: null,
          stderr: '',
          stdout: '',
          timedOut: false,
        };

  if (
    config.runTests &&
    commandCanRun &&
    (testRunResult.code !== 0 || testRunResult.timedOut)
  ) {
    violations.push({
      code: testRunResult.timedOut ? 'validation_timeout' : 'test_failure',
      message: testRunResult.timedOut
        ? `The clean validation command exceeded ${Math.ceil(validationTimeoutMs / 60_000)} minutes (${Math.ceil(validationTimeoutMs / 1000)} second authoritative budget).`
        : `The clean Playwright validation run failed with exit code ${testRunResult.code}.`,
      priority: 'critical',
      remediation: testRunResult.timedOut
        ? 'Remove hangs, bound external waits, or adjust the validator timeout deliberately.'
        : `Fix the failing tests. Recent output:\n${outputTail(testRunResult.stderr || testRunResult.stdout, 2000)}`,
      severity: 'error',
    });
  }

  const collection = collectTestFiles(cwd);
  const files = collection.files;
  violations.push(...collection.violations);
  const analysis = analyzeTests(files, cwd);
  violations.push(...analysis.violations);
  violations.push(...coverageSynthesisViolations(files, cwd));
  if (!analysis.tests.length) {
    violations.push({
      code: 'untested_critical_path',
      message: 'No inspectable Playwright tests were found.',
      priority: 'critical',
      remediation:
        'Add at least one Playwright test with observable assertions for the requested behavior.',
      severity: 'error',
    });
  }

  const requirements = parseRequirements(
    config.requirements,
    analysis.tests,
    violations,
  );
  for (const requirement of requirements.filter((item) => !item.passed)) {
    violations.push({
      code: requirement.critical
        ? 'untested_critical_path'
        : 'skipped_requirement',
      message: `Requirement ${requirement.id} has no evidence in a Playwright test: ${requirement.description}`,
      priority: requirement.critical ? 'critical' : 'high',
      remediation: `Reference ${requirement.id} in the title or annotation of a test that proves this behavior with assertions.`,
      severity: 'error',
    });
  }

  const coveredRequirements = requirements.filter((item) => item.passed).length;
  const requirementCoverage = requirements.length
    ? percentage(coveredRequirements, requirements.length)
    : (configuration.configuredRequirementTotal || 0) > 0
      ? 0
      : 100;
  const eligibleTests = analysis.tests.filter((test) => !test.skipped).length;
  const assertionQuality = eligibleTests
    ? percentage(analysis.testsWithMeaningfulAssertions, eligibleTests)
    : 0;
  const repositoryRoot = resolveRepositoryRoot(
    cwd,
    options.repositoryRoot,
    violations,
  );
  const coverage = readCoverage(
    cwd,
    repositoryRoot,
    config.coverageSummaryPaths,
    violations,
  );
  const changedCoverage = changedCoverageAnalysis(
    options.changeManifest,
    coverage,
  );
  if (config.minimum.changedLineCoverage > 0) {
    violations.push(...changedCoverage.violations);
  }
  const dimensions = {
    assertionQuality: thresholdResult(
      assertionQuality,
      config.minimum.assertionQuality,
    ),
    branchCoverage: thresholdResult(
      coverage.branchCoverage,
      config.minimum.branchCoverage,
    ),
    changedLineCoverage: {
      applicable: changedCoverage.applicable,
      minimum: config.minimum.changedLineCoverage,
      observed: changedCoverage.observed,
      passed:
        !changedCoverage.applicable ||
        config.minimum.changedLineCoverage === 0 ||
        (changedCoverage.complete &&
          thresholdResult(
            changedCoverage.observed,
            config.minimum.changedLineCoverage,
          ).passed),
    },
    lineCoverage: thresholdResult(
      coverage.lineCoverage,
      config.minimum.lineCoverage,
    ),
    requirementCoverage: thresholdResult(
      requirementCoverage,
      config.minimum.requirementCoverage,
    ),
  };

  const lowLineCoverageFiles = lowestCoverageFiles(
    coverage.files,
    'lineCoverage',
  );
  const lowBranchCoverageFiles = lowestCoverageFiles(
    coverage.files,
    'branchCoverage',
  );
  for (const threshold of [
    changedCoverage.applicable &&
    changedCoverage.complete &&
    config.minimum.changedLineCoverage > 0
      ? thresholdViolation(
          dimensions.changedLineCoverage,
          'Changed-line coverage',
          'changed_line_coverage',
          'Emit Istanbul coverage-final.json or LCOV with DA records so coverage can be mapped to the changed executable lines.',
          `Add tests for the uncovered changed lines and regenerate detailed coverage.${changedCoverage.uncovered.length ? ` Gaps: ${changedCoverage.uncovered.map((item) => `${item.file}:${item.lines.join(',')}${item.truncated ? ',…' : ''}`).join('; ')}` : ''}`,
        )
      : null,
    thresholdViolation(
      dimensions.lineCoverage,
      'Line coverage',
      'line_coverage',
      `Configure the validation command to generate one of: ${config.coverageSummaryPaths.join(', ')}. For Istanbul projects, add the json or lcov reporter.${lowLineCoverageFiles.length ? ` Lowest files: ${lowLineCoverageFiles.join('; ')}` : ''}`,
      `Add meaningful tests for uncovered line paths and regenerate coverage.${lowLineCoverageFiles.length ? ` Lowest files: ${lowLineCoverageFiles.join('; ')}` : ''}`,
    ),
    thresholdViolation(
      dimensions.branchCoverage,
      'Branch coverage',
      'branch_coverage',
      `Configure the validation command to generate branch coverage at one of: ${config.coverageSummaryPaths.join(', ')}.${lowBranchCoverageFiles.length ? ` Lowest files: ${lowBranchCoverageFiles.join('; ')}` : ''}`,
      `Add tests for uncovered branches and regenerate coverage.${lowBranchCoverageFiles.length ? ` Lowest files: ${lowBranchCoverageFiles.join('; ')}` : ''}`,
    ),
    thresholdViolation(
      dimensions.requirementCoverage,
      'Requirement coverage',
      'requirement_coverage',
      'Add requirement IDs to tests that provide observable evidence.',
    ),
    thresholdViolation(
      dimensions.assertionQuality,
      'Assertion quality',
      'assertion_quality',
      'Add meaningful observable assertions to every enabled test.',
    ),
  ]) {
    if (threshold) violations.push(threshold);
  }

  const uniqueViolations = deduplicateViolations(violations);
  const failOn = new Set(config.failOn);
  const mandatoryCodes = new Set([
    'test_failure',
    'validation_timeout',
    'line_coverage',
    'branch_coverage',
    'changed_line_coverage',
    'changed_coverage_incomplete',
    'requirement_coverage',
    'assertion_quality',
    'invalid_coverage_artifact',
    'coverage_artifact_synthesis',
    'invalid_change_manifest',
    'coverage_path_outside_workspace',
    'retry_policy_not_enforced',
    'analysis_incomplete',
    'invalid_validator_configuration',
  ]);
  const blocking = uniqueViolations.filter(
    (violation) =>
      mandatoryCodes.has(violation.code) || failOn.has(violation.code),
  );
  const { feedback, feedbackText } = feedbackFor(blocking);
  const completedAtMs = Date.now();
  const artifacts: ValidationResult['artifacts'] = {
    ...(coverage.sourcePath ? { coverage: coverage.sourcePath } : {}),
    ...(fs.existsSync(path.join(cwd, 'playwright-report'))
      ? { playwrightReport: 'playwright-report' }
      : {}),
    ...(fs.existsSync(path.join(cwd, 'test-results'))
      ? { testResults: 'test-results' }
      : {}),
    traces: findTraces(path.join(cwd, 'test-results'), cwd),
  };
  const result: ValidationResult = {
    artifacts,
    attempt: Math.max(1, options.attempt || 1),
    authoritative,
    changedCoverage: {
      applicable: changedCoverage.applicable,
      coveredLines: changedCoverage.coveredLines,
      instrumentedFiles: changedCoverage.instrumentedFiles,
      missingFiles: changedCoverage.missingFiles,
      productionFiles: changedCoverage.productionFiles,
      totalLines: changedCoverage.totalLines,
      truncated: changedCoverage.truncated,
      uncovered: changedCoverage.uncovered,
    },
    completedAt: new Date(completedAtMs).toISOString(),
    ...(coverage.sourcePath
      ? {
          coverageEvidence: {
            detailed: true as const,
            fresh: authoritative && config.runTests && commandCanRun,
            provenance: 'repository_reported_untrusted' as const,
            reviewRequired: true as const,
            sourcePath: coverage.sourcePath,
          },
        }
      : {}),
    dimensions,
    durationMs: completedAtMs - startedAtMs,
    feedback,
    feedbackText,
    passed: blocking.length === 0,
    requirements: {
      ...(configuration.configuredRequirementTotal === null
        ? {}
        : {
            configuredTotal: configuration.configuredRequirementTotal,
          }),
      covered: coveredRequirements,
      items: requirements,
      reported: requirements.length,
      total: requirements.length,
      truncated: configuration.requirementsTruncated,
    },
    schemaVersion: VALIDATION_SCHEMA_VERSION,
    startedAt,
    status: blocking.length === 0 ? 'passed' : 'failed',
    testRun: {
      command: config.runTests ? configuration.reportedCommand : null,
      durationMs: testRunResult.durationMs,
      exitCode: testRunResult.code,
      failedTests: failedTestNames(
        `${testRunResult.stdout}\n${testRunResult.stderr}`,
      ),
      passed:
        (!config.runTests || commandCanRun) &&
        testRunResult.code === 0 &&
        !testRunResult.timedOut,
      stderrTail: outputTail(testRunResult.stderr),
      stdoutTail: outputTail(testRunResult.stdout),
      timedOut: testRunResult.timedOut,
    },
    testSummary: {
      files: files.length,
      focused: analysis.focused,
      skipped: analysis.skipped,
      tests: analysis.tests.length,
      testsWithMeaningfulAssertions: analysis.testsWithMeaningfulAssertions,
    },
    violations: uniqueViolations
      .slice(0, MAX_REPORTED_VIOLATIONS)
      .map(boundedViolation),
    violationSummary: {
      reported: Math.min(uniqueViolations.length, MAX_REPORTED_VIOLATIONS),
      total: uniqueViolations.length,
      truncated: uniqueViolations.length > MAX_REPORTED_VIOLATIONS,
    },
  };

  if (options.outputDirectory) {
    fs.mkdirSync(options.outputDirectory, { recursive: true });
    const reportPath = path.join(
      options.outputDirectory,
      'validation-report.json',
    );
    result.artifacts.validationReport = truncateUtf8(
      reportPath,
      VALIDATOR_LIMITS.violationFileBytes,
    );
    enforceInlineResultLimit(result);
    fs.writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`);
  } else {
    enforceInlineResultLimit(result);
  }

  return result;
}
