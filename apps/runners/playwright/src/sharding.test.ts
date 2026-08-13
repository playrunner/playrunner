import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createBlobArtifact,
  readPlaywrightDiscoveryReport,
  validateBlobArtifacts,
  verifyBlobArtifact,
} from './sharding';

test('reads shardable tests from a discovery JSON report', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'playrunner-list-'));
  const reportPath = path.join(directory, 'report.json');
  fs.writeFileSync(
    reportPath,
    JSON.stringify({
      config: { fullyParallel: true },
      suites: [
        {
          specs: [
            {
              file: 'tests/example.spec.ts',
              tests: [{ projectName: 'chromium' }, { projectName: 'webkit' }],
            },
          ],
        },
      ],
    }),
  );

  assert.deepEqual(
    readPlaywrightDiscoveryReport({ reportPath, sourceRevision: 'abc123' }),
    {
      fileCount: 1,
      fullyParallel: true,
      projectCount: 2,
      shardableUnits: 2,
      sourceRevision: 'abc123',
      testCount: 2,
    },
  );
});

test('creates and verifies a checksummed blob manifest', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'playrunner-blob-'));
  fs.writeFileSync(path.join(directory, 'report-1.zip'), 'blob contents');
  const artifact = createBlobArtifact({
    blobDirectory: directory,
    logicalNodeId: 'node-1',
    playwrightVersion: '1.62.1',
    runtimeNodeId: 'node-1--shard-1-of-2',
    shardIndex: 1,
    shardTotal: 2,
    sourceRevision: 'abc123',
    testId: 'execution-1',
  });

  verifyBlobArtifact(artifact, path.join(directory, artifact.fileName));
  assert.equal(artifact.size, 13);
  assert.match(artifact.checksum, /^[a-f0-9]{64}$/);
  assert.equal(
    artifact.objectPath,
    'execution-1/node-1--shard-1-of-2/blob-report/report-1.zip',
  );
});

test('validates a complete same-version blob report set', () => {
  const artifacts = [2, 1].map((shardIndex) => ({
    checksum: `checksum-${shardIndex}`,
    fileName: `report-${shardIndex}.zip`,
    logicalNodeId: 'node-1',
    playwrightVersion: '1.62.1',
    runtimeNodeId: `node-1--shard-${shardIndex}-of-2`,
    shardIndex,
    shardTotal: 2,
    size: 100,
    url: `/blob/${shardIndex}`,
  }));

  assert.deepEqual(
    validateBlobArtifacts(artifacts).map((artifact) => artifact.shardIndex),
    [1, 2],
  );
  assert.throws(
    () =>
      validateBlobArtifacts([
        artifacts[0],
        { ...artifacts[1], playwrightVersion: '1.61.0' },
      ]),
    /different Playwright versions/,
  );
  assert.throws(
    () => validateBlobArtifacts([artifacts[0], artifacts[0]]),
    /duplicate shards/,
  );
});
