import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertNoProhibitedExactValues,
  containsProhibitedExactValue,
  CREDENTIAL_LEAK_MESSAGE,
  normalizeProhibitedExactValues,
} from './secret-values';
import type { SupervisorResult } from './supervisor';

const MAX_STAGED_BYTES = 75 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 80 * 1024 * 1024;
const MAX_STAGED_ENTRIES = 9_500;
const MAX_STAGE_DEPTH = 32;
const MAX_STAGED_FILE_BYTES = 64 * 1024 * 1024;
const MAX_STAGED_PATH_BYTES = 1_024;
const MAX_STAGED_PATH_SEGMENT_BYTES = 255;
const MAX_STAGE_DURATION_MS = 30_000;
const MAX_REPORTED_SKIPPED_FILES = 100;
const MAX_SKIPPED_PATH_BYTES = 512;
const EXECUTION_TOKEN_HEADER = 'x-execution-token';

export type AgentRuntimeContext = {
  bucketName?: string;
  cloudProvider: string;
  editorApiUrl: string;
  executionAuthToken: string;
  nodeId: string;
  testId: string;
};

export type AgentArtifactRefs = {
  artifactTruncation?: string;
  artifactsTruncated?: boolean;
  coverage?: string;
  patch?: string;
  playwrightReport?: string;
  repositoryStatus?: string;
  testResults?: string;
  traces: string[];
  validationHistory: string;
  validationReport?: string;
};

export type StagedArtifacts = {
  directory: string;
  relativeCoveragePath?: string;
  skippedFileCount: number;
  skippedFiles: string[];
  traces: string[];
  truncationManifest?: string;
};

function safeRelativePath(value: string): string | null {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (
    !normalized ||
    path.isAbsolute(normalized) ||
    normalized.split('/').includes('..')
  ) {
    return null;
  }
  return normalized;
}

function resolvesInsideRealRoot(root: string, target: string): boolean {
  try {
    const realRoot = fs.realpathSync(root);
    const realTarget = fs.realpathSync(target);
    return (
      realTarget === realRoot || realTarget.startsWith(`${realRoot}${path.sep}`)
    );
  } catch {
    return false;
  }
}

type CopyState = {
  deadline: number;
  entries: number;
  prohibitedExactValues: string[];
  skippedFileCount: number;
  skippedFiles: string[];
  used: { bytes: number };
};

function boundedPath(value: string): string {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= MAX_SKIPPED_PATH_BYTES) return value;
  return bytes.subarray(0, MAX_SKIPPED_PATH_BYTES).toString('utf8');
}

function recordSkipped(state: CopyState, root: string, source: string) {
  state.skippedFileCount += 1;
  if (state.skippedFiles.length < MAX_REPORTED_SKIPPED_FILES) {
    state.skippedFiles.push(boundedPath(path.relative(root, source)));
  }
}

function copyOpenedFile(
  source: string,
  destination: string,
  root: string,
  deadline: number,
  maximumBytes: number,
  prohibitedExactValues: readonly string[],
): number {
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const sourceDescriptor = fs.openSync(
    source,
    fs.constants.O_RDONLY | noFollow,
  );
  let destinationDescriptor: number | undefined;
  try {
    const openedStat = fs.fstatSync(sourceDescriptor);
    if (!openedStat.isFile()) throw new Error('Artifact source is not a file.');
    if (openedStat.size > maximumBytes) {
      throw new Error('Artifact source exceeds the per-file staging limit.');
    }
    const realRoot = fs.realpathSync(root);
    const realSource = fs.realpathSync(source);
    if (
      realSource !== realRoot &&
      !realSource.startsWith(`${realRoot}${path.sep}`)
    ) {
      throw new Error('Artifact source escaped the workspace.');
    }
    const currentStat = fs.statSync(realSource);
    if (
      currentStat.dev !== openedStat.dev ||
      currentStat.ino !== openedStat.ino
    ) {
      throw new Error('Artifact source changed while it was inspected.');
    }

    fs.mkdirSync(path.dirname(destination), { recursive: true });
    destinationDescriptor = fs.openSync(
      destination,
      fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_WRONLY |
        noFollow,
      0o600,
    );
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const maximumProhibitedBytes = prohibitedExactValues.reduce(
      (maximum, value) => Math.max(maximum, Buffer.byteLength(value, 'utf8')),
      0,
    );
    let inspectionCarry = Buffer.alloc(0);
    let copiedBytes = 0;
    for (;;) {
      if (Date.now() > deadline) {
        throw new Error('Artifact staging exceeded its duration limit.');
      }
      const bytesRead = fs.readSync(
        sourceDescriptor,
        buffer,
        0,
        buffer.length,
        null,
      );
      if (bytesRead === 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      const inspection = inspectionCarry.length
        ? Buffer.concat([inspectionCarry, chunk])
        : chunk;
      if (containsProhibitedExactValue(inspection, prohibitedExactValues)) {
        throw new Error(CREDENTIAL_LEAK_MESSAGE);
      }
      const carryBytes = Math.max(0, maximumProhibitedBytes - 1);
      inspectionCarry =
        carryBytes === 0
          ? Buffer.alloc(0)
          : inspection.length > carryBytes
            ? Buffer.from(inspection.subarray(inspection.length - carryBytes))
            : Buffer.from(inspection);
      copiedBytes += bytesRead;
      if (copiedBytes > maximumBytes) {
        throw new Error('Artifact source grew beyond the staging limit.');
      }
      let written = 0;
      while (written < bytesRead) {
        written += fs.writeSync(
          destinationDescriptor,
          chunk,
          written,
          bytesRead - written,
        );
      }
    }
    return copiedBytes;
  } finally {
    if (destinationDescriptor !== undefined)
      fs.closeSync(destinationDescriptor);
    fs.closeSync(sourceDescriptor);
  }
}

export function isArtifactArchivePathCompatible(
  stagingRoot: string,
  destination: string,
): boolean {
  const relative = path.relative(stagingRoot, destination);
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`)
  ) {
    return false;
  }
  const segments = relative.split(path.sep);
  return (
    segments.length <= MAX_STAGE_DEPTH &&
    Buffer.byteLength(segments.join('/'), 'utf8') <= MAX_STAGED_PATH_BYTES &&
    segments.every(
      (segment) =>
        segment.length > 0 &&
        !segment.includes('\\') &&
        Buffer.byteLength(segment, 'utf8') <= MAX_STAGED_PATH_SEGMENT_BYTES &&
        !Array.from(segment).some((character) => {
          const codePoint = character.codePointAt(0) as number;
          return codePoint <= 0x1f || codePoint === 0x7f;
        }),
    )
  );
}

function copyTreeBounded(options: {
  depth?: number;
  destination: string;
  destinationRoot: string;
  maximumBytes: number;
  maximumEntries: number;
  root: string;
  source: string;
  state: CopyState;
}) {
  assertNoProhibitedExactValues(
    path.relative(options.root, options.source),
    options.state.prohibitedExactValues,
  );
  assertNoProhibitedExactValues(
    path.relative(options.destinationRoot, options.destination),
    options.state.prohibitedExactValues,
  );
  if (
    Date.now() > options.state.deadline ||
    options.state.entries >= options.maximumEntries ||
    !isArtifactArchivePathCompatible(
      options.destinationRoot,
      options.destination,
    )
  ) {
    recordSkipped(options.state, options.root, options.source);
    return;
  }
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(options.source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    recordSkipped(options.state, options.root, options.source);
    return;
  }
  options.state.entries += 1;
  if (stat.isSymbolicLink()) {
    recordSkipped(options.state, options.root, options.source);
    return;
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(options.destination, { recursive: true });
    let directory: fs.Dir;
    try {
      directory = fs.opendirSync(options.source);
    } catch {
      recordSkipped(options.state, options.root, options.source);
      return;
    }
    try {
      for (;;) {
        const entry = directory.readSync();
        if (!entry) break;
        if (
          Date.now() > options.state.deadline ||
          options.state.entries >= options.maximumEntries
        ) {
          recordSkipped(options.state, options.root, options.source);
          break;
        }
        copyTreeBounded({
          ...options,
          depth: (options.depth || 0) + 1,
          destination: path.join(options.destination, entry.name),
          source: path.join(options.source, entry.name),
        });
      }
    } finally {
      directory.closeSync();
    }
    return;
  }
  if (!stat.isFile()) {
    recordSkipped(options.state, options.root, options.source);
    return;
  }
  const remainingBytes = options.maximumBytes - options.state.used.bytes;
  const maximumFileBytes = Math.min(
    MAX_STAGED_FILE_BYTES,
    Math.max(0, remainingBytes),
  );
  if (stat.size > maximumFileBytes) {
    recordSkipped(options.state, options.root, options.source);
    return;
  }
  try {
    const copiedBytes = copyOpenedFile(
      options.source,
      options.destination,
      options.root,
      options.state.deadline,
      maximumFileBytes,
      options.state.prohibitedExactValues,
    );
    options.state.used.bytes += copiedBytes;
  } catch (error) {
    fs.rmSync(options.destination, { force: true });
    if (error instanceof Error && error.message === CREDENTIAL_LEAK_MESSAGE) {
      throw error;
    }
    recordSkipped(options.state, options.root, options.source);
  }
}

function writeRequiredArtifact(options: {
  content: string;
  destination: string;
  maximumBytes: number;
  prohibitedExactValues: readonly string[];
  used: { bytes: number };
}) {
  assertNoProhibitedExactValues(options.content, options.prohibitedExactValues);
  const bytes = Buffer.byteLength(options.content, 'utf8');
  if (options.used.bytes + bytes > options.maximumBytes) {
    throw new Error(
      `Required AI Container artifacts exceed the ${options.maximumBytes}-byte staging limit.`,
    );
  }
  fs.mkdirSync(path.dirname(options.destination), { recursive: true });
  fs.writeFileSync(options.destination, options.content);
  options.used.bytes += bytes;
}

export function stageAgentArtifacts(options: {
  directory: string;
  maximumDurationMs?: number;
  maximumEntries?: number;
  maximumBytes?: number;
  patch: string;
  prohibitedExactValues?: readonly string[];
  repositoryStatus: string;
  supervisor: SupervisorResult;
  workspace: string;
}): StagedArtifacts {
  const prohibitedExactValues = normalizeProhibitedExactValues(
    options.prohibitedExactValues,
  );
  assertNoProhibitedExactValues(options.patch, prohibitedExactValues);
  assertNoProhibitedExactValues(
    options.repositoryStatus,
    prohibitedExactValues,
  );
  assertNoProhibitedExactValues(
    JSON.stringify(options.supervisor),
    prohibitedExactValues,
  );
  fs.rmSync(options.directory, { force: true, recursive: true });
  fs.mkdirSync(path.join(options.directory, 'validation'), {
    recursive: true,
  });
  const used = { bytes: 0 };
  const maximumBytes = options.maximumBytes ?? MAX_STAGED_BYTES;
  const manifestReserve = Math.min(
    64 * 1024,
    Math.max(256, Math.floor(maximumBytes * 0.01)),
    Math.max(0, Math.floor(maximumBytes / 4)),
  );
  const contentMaximumBytes = maximumBytes - manifestReserve;
  const copyState: CopyState = {
    deadline: Date.now() + (options.maximumDurationMs ?? MAX_STAGE_DURATION_MS),
    entries: 0,
    prohibitedExactValues,
    skippedFileCount: 0,
    skippedFiles: [],
    used,
  };
  const maximumEntries = options.maximumEntries ?? MAX_STAGED_ENTRIES;
  const historyAttempts: Array<Record<string, unknown>> = [];
  for (const attempt of options.supervisor.attemptHistory) {
    let relativeReportPath: string | undefined;
    if (attempt.validation) {
      relativeReportPath = `validation/attempt-${attempt.attempt}.json`;
      attempt.validation.artifacts.validationReport = relativeReportPath;
      writeRequiredArtifact({
        content: `${JSON.stringify(attempt.validation, null, 2)}\n`,
        destination: path.join(options.directory, relativeReportPath),
        maximumBytes: contentMaximumBytes,
        prohibitedExactValues,
        used,
      });
    }
    historyAttempts.push({
      agent: attempt.agent,
      attempt: attempt.attempt,
      ...(attempt.validation
        ? {
            validation: {
              attempt: attempt.validation.attempt,
              passed: attempt.validation.passed,
              report: relativeReportPath,
              status: attempt.validation.status,
            },
          }
        : {}),
    });
  }
  writeRequiredArtifact({
    content: `${JSON.stringify(
      {
        ...options.supervisor,
        attemptHistory: historyAttempts,
        validation: options.supervisor.validation
          ? {
              passed: options.supervisor.validation.passed,
              report: 'validation/final.json',
              status: options.supervisor.validation.status,
            }
          : null,
      },
      null,
      2,
    )}\n`,
    destination: path.join(options.directory, 'validation', 'history.json'),
    maximumBytes: contentMaximumBytes,
    prohibitedExactValues,
    used,
  });
  if (options.supervisor.validation) {
    writeRequiredArtifact({
      content: `${JSON.stringify(options.supervisor.validation, null, 2)}\n`,
      destination: path.join(options.directory, 'validation', 'final.json'),
      maximumBytes: contentMaximumBytes,
      prohibitedExactValues,
      used,
    });
  }
  writeRequiredArtifact({
    content: options.patch,
    destination: path.join(options.directory, 'workspace.patch'),
    maximumBytes: contentMaximumBytes,
    prohibitedExactValues,
    used,
  });
  writeRequiredArtifact({
    content: options.repositoryStatus,
    destination: path.join(options.directory, 'repository-status.txt'),
    maximumBytes: contentMaximumBytes,
    prohibitedExactValues,
    used,
  });

  let relativeCoveragePath: string | undefined;
  const coverageSource = options.supervisor.validation?.artifacts.coverage;
  const safeCoverageSource = coverageSource
    ? safeRelativePath(coverageSource)
    : null;
  if (safeCoverageSource) {
    const source = path.resolve(options.workspace, safeCoverageSource);
    const relativeToWorkspace = path.relative(options.workspace, source);
    if (
      relativeToWorkspace &&
      !relativeToWorkspace.startsWith(`..${path.sep}`) &&
      fs.existsSync(source) &&
      !fs.lstatSync(source).isSymbolicLink() &&
      resolvesInsideRealRoot(options.workspace, source)
    ) {
      const candidateCoveragePath = path.join(
        'coverage',
        path.basename(source),
      );
      copyTreeBounded({
        destination: path.join(options.directory, candidateCoveragePath),
        destinationRoot: options.directory,
        maximumBytes: contentMaximumBytes,
        maximumEntries,
        root: options.workspace,
        source,
        state: copyState,
      });
      if (fs.existsSync(path.join(options.directory, candidateCoveragePath))) {
        relativeCoveragePath = candidateCoveragePath;
      }
    }
  }

  for (const directoryName of ['playwright-report', 'test-results']) {
    copyTreeBounded({
      destination: path.join(options.directory, directoryName),
      destinationRoot: options.directory,
      maximumBytes: contentMaximumBytes,
      maximumEntries,
      root: options.workspace,
      source: path.join(options.workspace, directoryName),
      state: copyState,
    });
  }

  const traces = (options.supervisor.validation?.artifacts.traces || [])
    .map(safeRelativePath)
    .filter((value): value is string => Boolean(value))
    .filter((value) => fs.existsSync(path.join(options.directory, value)));
  let truncationManifest: string | undefined;
  if (copyState.skippedFileCount) {
    truncationManifest = 'artifact-truncation.json';
    const manifest = {
      maximumBytes: contentMaximumBytes,
      maximumEntries,
      reportedSkippedFiles: copyState.skippedFiles.length,
      skippedFileCount: copyState.skippedFileCount,
      skippedFiles: [...copyState.skippedFiles],
    };
    let content = `${JSON.stringify(manifest, null, 2)}\n`;
    while (
      used.bytes + Buffer.byteLength(content, 'utf8') > maximumBytes &&
      manifest.skippedFiles.length
    ) {
      manifest.skippedFiles.pop();
      manifest.reportedSkippedFiles = manifest.skippedFiles.length;
      content = `${JSON.stringify(manifest, null, 2)}\n`;
    }
    writeRequiredArtifact({
      content,
      destination: path.join(options.directory, truncationManifest),
      maximumBytes,
      prohibitedExactValues,
      used,
    });
  }
  return {
    directory: options.directory,
    ...(relativeCoveragePath ? { relativeCoveragePath } : {}),
    skippedFileCount: copyState.skippedFileCount,
    skippedFiles: copyState.skippedFiles,
    traces,
    ...(truncationManifest ? { truncationManifest } : {}),
  };
}

function archive(directory: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-czf', '-', '.'], {
      cwd: directory,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    let stderr = '';
    let archiveBytes = 0;
    let failed = false;
    const fail = (error: Error) => {
      if (failed) return;
      failed = true;
      child.kill('SIGKILL');
      reject(error);
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      archiveBytes += chunk.length;
      if (archiveBytes > MAX_ARCHIVE_BYTES) {
        fail(
          new Error(
            `AI Container artifact archive exceeds ${MAX_ARCHIVE_BYTES} bytes.`,
          ),
        );
        return;
      }
      chunks.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4_000);
    });
    child.on('error', (error) => fail(error));
    child.on('close', (code) => {
      if (failed) return;
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`Artifact archive failed (${code}): ${stderr}`));
    });
  });
}

function outputPath(runtime: AgentRuntimeContext, suffix: string): string {
  const encodedSuffix = suffix
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `/outputs/${encodeURIComponent(runtime.testId)}/${encodeURIComponent(runtime.nodeId)}/${encodedSuffix}`;
}

function containsRegularFile(
  directory: string,
  maximumEntries = MAX_STAGED_ENTRIES,
): boolean {
  if (!fs.existsSync(directory)) return false;
  const pending = [directory];
  let entries = 0;
  while (pending.length && entries < maximumEntries) {
    const current = pending.pop()!;
    const stat = fs.lstatSync(current);
    entries += 1;
    if (stat.isSymbolicLink()) continue;
    if (stat.isFile()) return true;
    if (!stat.isDirectory()) continue;
    for (const entry of fs.readdirSync(current)) {
      pending.push(path.join(current, entry));
    }
  }
  return false;
}

export async function uploadAgentArtifacts(
  staged: StagedArtifacts,
  runtime: AgentRuntimeContext,
  fetcher: typeof fetch = fetch,
): Promise<AgentArtifactRefs> {
  if (
    !runtime.editorApiUrl ||
    !runtime.executionAuthToken ||
    !runtime.nodeId ||
    !runtime.testId
  ) {
    throw new Error(
      'AI Container artifact upload is missing editor API runtime context.',
    );
  }
  const bytes = await archive(staged.directory);
  const uploadUrl = new URL(
    `/api/outputs/${encodeURIComponent(runtime.testId)}/${encodeURIComponent(runtime.nodeId)}`,
    runtime.editorApiUrl,
  );
  if (runtime.bucketName) {
    uploadUrl.searchParams.set('bucketName', runtime.bucketName);
  }
  const response = await fetcher(uploadUrl, {
    body: new Uint8Array(bytes),
    headers: {
      'Content-Type': 'application/gzip',
      [EXECUTION_TOKEN_HEADER]: runtime.executionAuthToken,
    },
    method: 'POST',
    signal: AbortSignal.timeout(2 * 60_000),
  });
  if (!response.ok) {
    throw new Error(
      `AI Container artifact upload failed (${response.status}): ${(await response.text()).slice(0, 2_000)}`,
    );
  }

  const playwrightReportIndex = path.join(
    staged.directory,
    'playwright-report',
    'index.html',
  );

  return {
    ...(staged.truncationManifest
      ? {
          artifactTruncation: outputPath(runtime, staged.truncationManifest),
          artifactsTruncated: true,
        }
      : {}),
    ...(staged.relativeCoveragePath
      ? { coverage: outputPath(runtime, staged.relativeCoveragePath) }
      : {}),
    patch: outputPath(runtime, 'workspace.patch'),
    ...(fs.existsSync(playwrightReportIndex) &&
    fs.lstatSync(playwrightReportIndex).isFile() &&
    !fs.lstatSync(playwrightReportIndex).isSymbolicLink()
      ? {
          playwrightReport: outputPath(runtime, 'playwright-report/index.html'),
        }
      : {}),
    repositoryStatus: outputPath(runtime, 'repository-status.txt'),
    ...(containsRegularFile(path.join(staged.directory, 'test-results'))
      ? { testResults: outputPath(runtime, 'test-results') }
      : {}),
    traces: staged.traces.map((trace) => outputPath(runtime, trace)),
    validationHistory: outputPath(runtime, 'validation/history.json'),
    ...(fs.existsSync(path.join(staged.directory, 'validation', 'final.json'))
      ? { validationReport: outputPath(runtime, 'validation/final.json') }
      : {}),
  };
}
