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
};

const MAX_ERROR_CONTEXT_CHARACTERS = 100_000;

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

function collectSpecs(suite: JsonRecord): JsonRecord[] {
  const specs = Array.isArray(suite.specs) ? suite.specs.filter(isRecord) : [];
  const childSuites = Array.isArray(suite.suites)
    ? suite.suites.filter(isRecord)
    : [];
  return specs.concat(childSuites.flatMap(collectSpecs));
}

function collectErrorContexts(args: {
  nodeId: string;
  testId: string;
  workingDir: string;
}): PlaywrightReportData['errorContexts'] {
  const resultsDir = path.join(args.workingDir, 'test-results');
  if (!fs.existsSync(resultsDir)) {
    return [];
  }

  const contexts: PlaywrightReportData['errorContexts'] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile() && entry.name === 'error-context.md') {
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
  };
  visit(resultsDir);
  return contexts;
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

  for (const spec of suites.flatMap(collectSpecs)) {
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

        const attachments = Array.isArray(result.attachments)
          ? result.attachments.filter(isRecord).map((attachment) => ({
              ...(typeof attachment.name === 'string'
                ? { name: attachment.name }
                : {}),
              ...(typeof attachment.contentType === 'string'
                ? { contentType: attachment.contentType }
                : {}),
              ...(typeof attachment.path === 'string'
                ? { path: attachment.path }
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
            .join(' — '),
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
          errors: Array.isArray(result.errors) ? result.errors : [],
          stdout: Array.isArray(result.stdout) ? result.stdout : [],
          stderr: Array.isArray(result.stderr) ? result.stderr : [],
          steps: Array.isArray(result.steps) ? result.steps : [],
          attachments,
        });
      }
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ...(report.stats !== undefined ? { stats: report.stats } : {}),
    errors: Array.isArray(report.errors) ? report.errors : [],
    errorContexts: collectErrorContexts(args),
    failures,
  };
}
