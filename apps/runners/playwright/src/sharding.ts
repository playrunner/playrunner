import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

type JsonRecord = Record<string, any>;

export type PlaywrightDiscoveryResult = {
  fileCount: number;
  fullyParallel: boolean;
  projectCount: number;
  shardableUnits: number;
  sourceRevision?: string;
  testCount: number;
};

export type PlaywrightBlobArtifact = {
  checksum: string;
  fileName: string;
  logicalNodeId: string;
  objectPath?: string;
  playwrightVersion: string;
  runtimeNodeId: string;
  shardIndex: number;
  shardTotal: number;
  size: number;
  sourceRevision?: string;
  url: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectSpecs(suite: JsonRecord): JsonRecord[] {
  const specs = Array.isArray(suite.specs) ? suite.specs.filter(isRecord) : [];
  const childSuites = Array.isArray(suite.suites)
    ? suite.suites.filter(isRecord)
    : [];
  return specs.concat(childSuites.flatMap(collectSpecs));
}

export function readPlaywrightDiscoveryReport(args: {
  reportPath: string;
  sourceRevision?: string;
}): PlaywrightDiscoveryResult {
  const report = JSON.parse(
    fs.readFileSync(args.reportPath, 'utf8'),
  ) as unknown;
  if (!isRecord(report)) {
    throw new Error('Playwright discovery report is malformed.');
  }

  const suites = Array.isArray(report.suites)
    ? report.suites.filter(isRecord)
    : [];
  const specs = suites.flatMap(collectSpecs);
  const testCount = specs.reduce(
    (count, spec) =>
      count +
      (Array.isArray(spec.tests) ? spec.tests.filter(isRecord).length : 0),
    0,
  );
  const files = new Set(
    specs
      .map((spec) => (typeof spec.file === 'string' ? spec.file : ''))
      .filter(Boolean),
  );
  const projects = new Set<string>();
  for (const spec of specs) {
    for (const test of Array.isArray(spec.tests)
      ? spec.tests.filter(isRecord)
      : []) {
      if (typeof test.projectName === 'string') projects.add(test.projectName);
    }
  }
  const fullyParallel = report.config?.fullyParallel === true;
  const fileCount = files.size;
  const projectCount = Math.max(1, projects.size);

  return {
    fileCount,
    fullyParallel,
    projectCount,
    shardableUnits: Math.max(
      1,
      fullyParallel ? testCount : fileCount * projectCount,
    ),
    ...(args.sourceRevision ? { sourceRevision: args.sourceRevision } : {}),
    testCount,
  };
}

export function createBlobArtifact(args: {
  blobDirectory: string;
  logicalNodeId: string;
  playwrightVersion: string;
  runtimeNodeId: string;
  shardIndex: number;
  shardTotal: number;
  sourceRevision?: string;
  testId: string;
}): PlaywrightBlobArtifact {
  const zipFiles = fs
    .readdirSync(args.blobDirectory)
    .filter((fileName) => fileName.endsWith('.zip'));
  if (zipFiles.length !== 1) {
    throw new Error(
      `Expected exactly one Playwright blob report, received ${zipFiles.length}.`,
    );
  }

  const fileName = zipFiles[0];
  const filePath = path.join(args.blobDirectory, fileName);
  const bytes = fs.readFileSync(filePath);
  return {
    checksum: crypto.createHash('sha256').update(bytes).digest('hex'),
    fileName,
    logicalNodeId: args.logicalNodeId,
    objectPath: `${args.testId}/${args.runtimeNodeId}/blob-report/${fileName}`,
    playwrightVersion: args.playwrightVersion,
    runtimeNodeId: args.runtimeNodeId,
    shardIndex: args.shardIndex,
    shardTotal: args.shardTotal,
    size: bytes.length,
    ...(args.sourceRevision ? { sourceRevision: args.sourceRevision } : {}),
    url: `/outputs/${args.testId}/${args.runtimeNodeId}/blob-report/${encodeURIComponent(fileName)}`,
  };
}

export function verifyBlobArtifact(
  artifact: PlaywrightBlobArtifact,
  filePath: string,
): void {
  const bytes = fs.readFileSync(filePath);
  if (bytes.length !== artifact.size) {
    throw new Error(`Blob size mismatch for shard ${artifact.shardIndex}.`);
  }
  const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
  if (checksum !== artifact.checksum) {
    throw new Error(`Blob checksum mismatch for shard ${artifact.shardIndex}.`);
  }
}

export function validateBlobArtifacts(
  value: unknown,
): PlaywrightBlobArtifact[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Aggregation requires at least one blob artifact.');
  }
  const artifacts = value as PlaywrightBlobArtifact[];
  const expectedTotal = artifacts.length;
  const indexes = new Set<number>();
  const versions = new Set<string>();
  for (const artifact of artifacts) {
    if (
      !artifact ||
      typeof artifact.fileName !== 'string' ||
      typeof artifact.runtimeNodeId !== 'string' ||
      typeof artifact.checksum !== 'string' ||
      typeof artifact.size !== 'number'
    ) {
      throw new Error('Aggregation received a malformed blob manifest.');
    }
    indexes.add(artifact.shardIndex);
    versions.add(artifact.playwrightVersion);
    if (artifact.shardTotal !== expectedTotal) {
      throw new Error('Blob manifests disagree about the shard total.');
    }
  }
  if (indexes.size !== expectedTotal) {
    throw new Error('Blob manifests contain duplicate shards.');
  }
  if (versions.size !== 1) {
    throw new Error(
      'Blob manifests were produced by different Playwright versions.',
    );
  }
  for (let index = 1; index <= expectedTotal; index++) {
    if (!indexes.has(index)) {
      throw new Error(`Blob report for shard ${index} is missing.`);
    }
  }
  return [...artifacts].sort(
    (left, right) => left.shardIndex - right.shardIndex,
  );
}
