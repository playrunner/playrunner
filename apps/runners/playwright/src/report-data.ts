import fs from 'fs';
import path from 'path';

type JsonRecord = Record<string, any>;

export type PlaywrightReportData = {
  errorContexts: Array<{
    path: string;
    text: string;
    url: string;
  }>;
  errors: unknown[];
  failures: Array<{
    attachments: Array<{
      contentType?: string;
      name?: string;
      path?: string;
      url?: string;
    }>;
    duration?: number;
    errors: unknown[];
    location?: unknown;
    projectName?: string;
    retry?: number;
    status?: string;
    stderr: unknown[];
    stdout: unknown[];
    steps: unknown[];
    title: string;
  }>;
  generatedAt: string;
  schemaVersion: 1;
  stats?: unknown;
  truncation: {
    contextsFound: number;
    contextsIncluded: number;
    failuresFound: number;
    failuresIncluded: number;
    reportFileTooLarge?: boolean;
    traversalTruncated?: boolean;
    truncated: boolean;
  };
};

const MAX_REPORT_FILE_BYTES = 16 * 1024 * 1024;
const MAX_INLINE_REPORT_BYTES = 1024 * 1024;
const MAX_FAILURES = 25;
const MAX_CONTEXTS = 10;
const MAX_ERROR_CONTEXT_CHARACTERS = 8_000;
const MAX_CONTEXT_ENTRIES = 2_000;
const MAX_SUITE_NODES = 10_000;
const MAX_VALUE_ARRAY_ENTRIES = 8;
const MAX_VALUE_KEYS = 16;
const MAX_VALUE_DEPTH = 4;
const MAX_VALUE_STRING_CHARACTERS = 2_000;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function reportArtifactUrl(
  artifactPath: unknown,
  workingDir: string,
  testId: string,
  nodeId: string,
): string | undefined {
  if (typeof artifactPath !== 'string' || !artifactPath.trim()) {
    return undefined;
  }

  const absolutePath = path.isAbsolute(artifactPath)
    ? artifactPath
    : path.resolve(workingDir, artifactPath);
  const relativePath = path.relative(workingDir, absolutePath);
  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    return undefined;
  }

  return `/outputs/${testId}/${nodeId}/${relativePath
    .split(path.sep)
    .map(encodeURIComponent)
    .join('/')}`;
}

function boundedString(value: unknown, limit = MAX_VALUE_STRING_CHARACTERS) {
  return typeof value === 'string' ? value.slice(0, limit) : undefined;
}

function boundedJsonValue(value: unknown, depth = 0): unknown {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }
  if (typeof value === 'string') {
    return value.slice(0, MAX_VALUE_STRING_CHARACTERS);
  }
  if (depth >= MAX_VALUE_DEPTH) {
    return Array.isArray(value) ? [] : isRecord(value) ? {} : undefined;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_VALUE_ARRAY_ENTRIES)
      .map((entry) => boundedJsonValue(entry, depth + 1))
      .filter((entry) => entry !== undefined);
  }
  if (isRecord(value)) {
    const result: JsonRecord = {};
    for (const key of Object.keys(value).sort().slice(0, MAX_VALUE_KEYS)) {
      const entry = boundedJsonValue(value[key], depth + 1);
      if (entry !== undefined) result[key] = entry;
    }
    return result;
  }
  return undefined;
}

function collectSpecs(suites: JsonRecord[]): {
  specs: JsonRecord[];
  traversalTruncated: boolean;
} {
  const specs: JsonRecord[] = [];
  const pending = [...suites];
  let visited = 0;
  while (pending.length && visited < MAX_SUITE_NODES) {
    const suite = pending.shift()!;
    visited += 1;
    if (Array.isArray(suite.specs)) {
      specs.push(...suite.specs.filter(isRecord));
    }
    if (Array.isArray(suite.suites)) {
      pending.push(...suite.suites.filter(isRecord));
    }
  }
  return {
    specs,
    traversalTruncated: pending.length > 0,
  };
}

function collectErrorContexts(args: {
  nodeId: string;
  testId: string;
  workingDir: string;
}): {
  contexts: PlaywrightReportData['errorContexts'];
  contextsFound: number;
  traversalTruncated: boolean;
} {
  const resultsDir = path.join(args.workingDir, 'test-results');
  if (!fs.existsSync(resultsDir)) {
    return { contexts: [], contextsFound: 0, traversalTruncated: false };
  }

  const contexts: PlaywrightReportData['errorContexts'] = [];
  const pending = [resultsDir];
  let contextsFound = 0;
  let entriesVisited = 0;
  while (pending.length && entriesVisited < MAX_CONTEXT_ENTRIES) {
    const directory = pending.shift()!;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      entriesVisited += 1;
      if (entriesVisited > MAX_CONTEXT_ENTRIES) break;
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      } else if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile() && entry.name === 'error-context.md') {
        contextsFound += 1;
        if (contexts.length >= MAX_CONTEXTS) continue;
        const relativePath = path.relative(args.workingDir, entryPath);
        contexts.push({
          path: relativePath,
          text: fs
            .readFileSync(entryPath, 'utf8')
            .slice(0, MAX_ERROR_CONTEXT_CHARACTERS),
          url: `/outputs/${args.testId}/${args.nodeId}/${relativePath
            .split(path.sep)
            .map(encodeURIComponent)
            .join('/')}`,
        });
      }
    }
  }
  return {
    contexts,
    contextsFound,
    traversalTruncated: pending.length > 0,
  };
}

function compactInlineReport(
  report: PlaywrightReportData,
): PlaywrightReportData {
  while (
    Buffer.byteLength(JSON.stringify(report), 'utf8') >
      MAX_INLINE_REPORT_BYTES &&
    report.failures.length > 1
  ) {
    report.failures.pop();
    report.truncation.failuresIncluded = report.failures.length;
    report.truncation.truncated = true;
  }
  while (
    Buffer.byteLength(JSON.stringify(report), 'utf8') >
      MAX_INLINE_REPORT_BYTES &&
    report.errorContexts.length
  ) {
    report.errorContexts.pop();
    report.truncation.contextsIncluded = report.errorContexts.length;
    report.truncation.truncated = true;
  }
  if (
    Buffer.byteLength(JSON.stringify(report), 'utf8') > MAX_INLINE_REPORT_BYTES
  ) {
    for (const failure of report.failures) {
      failure.steps = [];
      failure.stdout = [];
      failure.stderr = [];
    }
    report.truncation.truncated = true;
  }
  return report;
}

export function readPlaywrightReportData(args: {
  nodeId: string;
  reportPath: string;
  testId: string;
  workingDir: string;
}): PlaywrightReportData | undefined {
  if (!fs.existsSync(args.reportPath)) {
    return undefined;
  }

  const reportSize = fs.statSync(args.reportPath).size;
  if (reportSize > MAX_REPORT_FILE_BYTES) {
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      errors: [],
      errorContexts: [],
      failures: [],
      truncation: {
        contextsFound: 0,
        contextsIncluded: 0,
        failuresFound: 0,
        failuresIncluded: 0,
        reportFileTooLarge: true,
        truncated: true,
      },
    };
  }

  let report: unknown;
  try {
    report = JSON.parse(fs.readFileSync(args.reportPath, 'utf8'));
  } catch {
    return undefined;
  }
  if (!isRecord(report)) {
    return undefined;
  }

  const suites = Array.isArray(report.suites)
    ? report.suites.filter(isRecord)
    : [];
  const failures: PlaywrightReportData['failures'] = [];
  let failuresFound = 0;
  const collected = collectSpecs(suites);

  for (const spec of collected.specs) {
    const tests = Array.isArray(spec.tests) ? spec.tests.filter(isRecord) : [];
    for (const test of tests) {
      const results = Array.isArray(test.results)
        ? test.results.filter(isRecord)
        : [];
      for (const result of results) {
        if (
          result.status === 'passed' ||
          result.status === 'skipped' ||
          result.status === 'interrupted'
        ) {
          continue;
        }
        failuresFound += 1;
        if (failures.length >= MAX_FAILURES) continue;

        const attachments = Array.isArray(result.attachments)
          ? result.attachments
              .filter(isRecord)
              .slice(0, MAX_VALUE_ARRAY_ENTRIES)
              .map((attachment) => ({
                ...(boundedString(attachment.name)
                  ? { name: boundedString(attachment.name) }
                  : {}),
                ...(boundedString(attachment.contentType)
                  ? { contentType: boundedString(attachment.contentType) }
                  : {}),
                ...(boundedString(attachment.path)
                  ? { path: boundedString(attachment.path) }
                  : {}),
                ...(reportArtifactUrl(
                  attachment.path,
                  args.workingDir,
                  args.testId,
                  args.nodeId,
                )
                  ? {
                      url: reportArtifactUrl(
                        attachment.path,
                        args.workingDir,
                        args.testId,
                        args.nodeId,
                      ),
                    }
                  : {}),
              }))
          : [];

        failures.push({
          title: [spec.title, test.projectName]
            .filter((value) => typeof value === 'string' && value.trim())
            .join(' — ')
            .slice(0, MAX_VALUE_STRING_CHARACTERS),
          ...(spec.file || spec.line || spec.column
            ? {
                location: {
                  file: spec.file,
                  line: spec.line,
                  column: spec.column,
                },
              }
            : {}),
          ...(typeof test.projectName === 'string'
            ? { projectName: test.projectName }
            : {}),
          ...(typeof result.status === 'string'
            ? { status: result.status }
            : {}),
          ...(typeof result.duration === 'number'
            ? { duration: result.duration }
            : {}),
          ...(typeof result.retry === 'number' ? { retry: result.retry } : {}),
          errors: Array.isArray(result.errors)
            ? (boundedJsonValue(result.errors) as unknown[])
            : [],
          stdout: Array.isArray(result.stdout)
            ? (boundedJsonValue(result.stdout) as unknown[])
            : [],
          stderr: Array.isArray(result.stderr)
            ? (boundedJsonValue(result.stderr) as unknown[])
            : [],
          steps: Array.isArray(result.steps)
            ? (boundedJsonValue(result.steps) as unknown[])
            : [],
          attachments,
        });
      }
    }
  }

  const errorContexts = collectErrorContexts(args);
  return compactInlineReport({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ...(report.stats !== undefined
      ? { stats: boundedJsonValue(report.stats) }
      : {}),
    errors: Array.isArray(report.errors)
      ? (boundedJsonValue(report.errors) as unknown[])
      : [],
    errorContexts: errorContexts.contexts,
    failures,
    truncation: {
      contextsFound: errorContexts.contextsFound,
      contextsIncluded: errorContexts.contexts.length,
      failuresFound,
      failuresIncluded: failures.length,
      ...(collected.traversalTruncated || errorContexts.traversalTruncated
        ? { traversalTruncated: true }
        : {}),
      truncated:
        failuresFound > failures.length ||
        errorContexts.contextsFound > errorContexts.contexts.length ||
        collected.traversalTruncated ||
        errorContexts.traversalTruncated,
    },
  });
}
