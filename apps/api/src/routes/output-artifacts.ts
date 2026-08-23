import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { encodeRelativeOutputPath } from './output-paths';

export const OUTPUT_ARTIFACT_MANIFEST_FILE = 'artifact-manifest.json';
export const OUTPUT_ARTIFACT_MANIFEST_SCHEMA_VERSION = '1.0';

export type OutputArtifactRefs = {
  artifactManifest: string;
  artifactTruncation?: string;
  browserCoverage?: string;
  coverage?: string;
  patch?: string;
  playwrightReport?: string;
  repositoryStatus?: string;
  validationHistory?: string;
  validationReport?: string;
  vitestCoverage?: string;
  vitestLcov?: string;
  vitestResults?: string;
};

export type OutputArtifactManifest = {
  artifacts: OutputArtifactRefs;
  nodeId: string;
  schemaVersion: typeof OUTPUT_ARTIFACT_MANIFEST_SCHEMA_VERSION;
  testId: string;
};

const ARTIFACT_CANDIDATES = Object.freeze({
  artifactTruncation: ['artifact-truncation.json'],
  browserCoverage: [
    'coverage/coverage-final.json',
    'coverage/lcov.info',
    'coverage/coverage-summary.json',
  ],
  patch: ['workspace.patch'],
  playwrightReport: ['playwright-report/index.html'],
  repositoryStatus: ['repository-status.txt'],
  validationHistory: ['validation/history.json'],
  validationReport: ['validation/final.json'],
  vitestCoverage: ['test-results/vitest-coverage/coverage-final.json'],
  vitestLcov: ['test-results/vitest-coverage/lcov.info'],
  vitestResults: ['test-results/vitest-results.json'],
});

function isContainedPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}

function findRegularArtifact(
  outputsDir: string,
  candidates: readonly string[],
): string | undefined {
  const realOutputRoot = fs.realpathSync(outputsDir);
  for (const relativePath of candidates) {
    const candidate = path.join(outputsDir, relativePath);
    if (!fs.existsSync(candidate)) continue;
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    const realCandidate = fs.realpathSync(candidate);
    if (!isContainedPath(realOutputRoot, realCandidate)) continue;
    return candidate;
  }
  return undefined;
}

function outputUrl(
  outputsDir: string,
  testId: string,
  nodeId: string,
  filePath: string,
): string {
  return `/outputs/${encodeURIComponent(testId)}/${encodeURIComponent(nodeId)}/${encodeRelativeOutputPath(outputsDir, filePath)}`;
}

export function writeOutputArtifactManifest(options: {
  nodeId: string;
  outputsDir: string;
  testId: string;
}): OutputArtifactManifest {
  const { nodeId, outputsDir, testId } = options;
  const manifestPath = path.join(outputsDir, OUTPUT_ARTIFACT_MANIFEST_FILE);

  // The API, rather than an uploaded archive, owns this index of trusted paths.
  fs.rmSync(manifestPath, { force: true, recursive: true });

  const artifacts: OutputArtifactRefs = {
    artifactManifest: outputUrl(outputsDir, testId, nodeId, manifestPath),
  };
  for (const [name, candidates] of Object.entries(ARTIFACT_CANDIDATES)) {
    const artifact = findRegularArtifact(outputsDir, candidates);
    if (!artifact) continue;
    artifacts[name as keyof typeof ARTIFACT_CANDIDATES] = outputUrl(
      outputsDir,
      testId,
      nodeId,
      artifact,
    );
  }
  if (artifacts.browserCoverage) {
    // Preserve the existing agent result field while giving the browser
    // coverage report an unambiguous name in the manifest.
    artifacts.coverage = artifacts.browserCoverage;
  }

  const manifest: OutputArtifactManifest = {
    artifacts,
    nodeId,
    schemaVersion: OUTPUT_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    testId,
  };
  const temporaryPath = path.join(
    outputsDir,
    `.${OUTPUT_ARTIFACT_MANIFEST_FILE}.${randomUUID()}`,
  );
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, manifestPath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
  return manifest;
}
