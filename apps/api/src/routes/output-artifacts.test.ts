import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  OUTPUT_ARTIFACT_MANIFEST_FILE,
  writeOutputArtifactManifest,
} from './output-artifacts';

function writeArtifact(root: string, relativePath: string): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, relativePath);
}

test('writes an authenticated index for every supported AI Container artifact', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'output-artifacts-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  for (const relativePath of [
    'artifact-truncation.json',
    'coverage/coverage-final.json',
    'playwright-report/index.html',
    'repository-status.txt',
    'test-results/vitest-coverage/coverage-final.json',
    'test-results/vitest-coverage/lcov.info',
    'test-results/vitest-results.json',
    'validation/final.json',
    'validation/history.json',
    'workspace.patch',
  ]) {
    writeArtifact(root, relativePath);
  }

  const manifest = writeOutputArtifactManifest({
    nodeId: 'agent-node',
    outputsDir: root,
    testId: 'execution-1',
  });
  const base = '/outputs/execution-1/agent-node/';
  assert.deepEqual(manifest, {
    artifacts: {
      artifactManifest: `${base}artifact-manifest.json`,
      artifactTruncation: `${base}artifact-truncation.json`,
      browserCoverage: `${base}coverage/coverage-final.json`,
      coverage: `${base}coverage/coverage-final.json`,
      patch: `${base}workspace.patch`,
      playwrightReport: `${base}playwright-report/index.html`,
      repositoryStatus: `${base}repository-status.txt`,
      validationHistory: `${base}validation/history.json`,
      validationReport: `${base}validation/final.json`,
      vitestCoverage: `${base}test-results/vitest-coverage/coverage-final.json`,
      vitestLcov: `${base}test-results/vitest-coverage/lcov.info`,
      vitestResults: `${base}test-results/vitest-results.json`,
    },
    nodeId: 'agent-node',
    schemaVersion: '1.0',
    testId: 'execution-1',
  });
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(path.join(root, OUTPUT_ARTIFACT_MANIFEST_FILE), 'utf8'),
    ),
    manifest,
  );
});

test('omits missing and linked artifacts and replaces an uploaded manifest', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'output-artifacts-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-artifacts-'));
  t.after(() => {
    fs.rmSync(root, { force: true, recursive: true });
    fs.rmSync(outside, { force: true, recursive: true });
  });
  writeArtifact(root, 'validation/history.json');
  writeArtifact(root, OUTPUT_ARTIFACT_MANIFEST_FILE);
  writeArtifact(outside, 'coverage-final.json');
  fs.mkdirSync(path.join(root, 'coverage'), { recursive: true });
  fs.symlinkSync(
    path.join(outside, 'coverage-final.json'),
    path.join(root, 'coverage', 'coverage-final.json'),
  );

  const manifest = writeOutputArtifactManifest({
    nodeId: 'node-1',
    outputsDir: root,
    testId: 'test-1',
  });

  assert.deepEqual(manifest.artifacts, {
    artifactManifest: '/outputs/test-1/node-1/artifact-manifest.json',
    validationHistory: '/outputs/test-1/node-1/validation/history.json',
  });
  assert.equal(manifest.artifacts.browserCoverage, undefined);
  assert.equal(
    JSON.parse(
      fs.readFileSync(path.join(root, OUTPUT_ARTIFACT_MANIFEST_FILE), 'utf8'),
    ).schemaVersion,
    '1.0',
  );
});
