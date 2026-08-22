import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  isArtifactArchivePathCompatible,
  stageAgentArtifacts,
  uploadAgentArtifacts,
} from './artifacts';
import type { SupervisorResult } from './supervisor';
import type { ValidationResult } from './validator';

function supervisor(): SupervisorResult {
  return {
    attemptHistory: [],
    attempts: 1,
    completedAt: '2026-08-21T00:00:01.000Z',
    durationMs: 1,
    schemaVersion: '1.0',
    startedAt: '2026-08-21T00:00:00.000Z',
    status: 'failed',
    stopReason: 'max_attempts',
    validation: null,
  };
}

test('stages supervisor history, patch, status, and bounded report files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-artifacts-'));
  try {
    const workspace = path.join(root, 'repo');
    const output = path.join(root, 'artifacts');
    fs.mkdirSync(path.join(workspace, 'playwright-report'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(workspace, 'playwright-report', 'index.html'),
      '<html></html>',
    );
    fs.symlinkSync(
      path.join(workspace, 'playwright-report', 'index.html'),
      path.join(workspace, 'playwright-report', 'unsafe-link'),
    );
    const staged = stageAgentArtifacts({
      directory: output,
      patch: 'diff --git a/a b/a',
      repositoryStatus: ' M a\n',
      supervisor: supervisor(),
      workspace,
    });

    assert.equal(
      fs.existsSync(path.join(output, 'validation', 'history.json')),
      true,
    );
    assert.equal(
      fs.readFileSync(path.join(output, 'workspace.patch'), 'utf8'),
      'diff --git a/a b/a',
    );
    assert.equal(
      fs.existsSync(path.join(output, 'playwright-report', 'unsafe-link')),
      false,
    );
    assert.deepEqual(staged.skippedFiles, ['playwright-report/unsafe-link']);
    assert.equal(staged.skippedFileCount, 1);
    assert.equal(staged.truncationManifest, 'artifact-truncation.json');
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('fails closed before staging a patch that contains a credential', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-secret-patch-'));
  const credential = 'model-secret-value';
  try {
    assert.throws(
      () =>
        stageAgentArtifacts({
          directory: path.join(root, 'artifacts'),
          patch: `diff --git a/test.ts b/test.ts\n+${credential}\n`,
          prohibitedExactValues: [credential],
          repositoryStatus: ' M test.ts\n',
          supervisor: supervisor(),
          workspace: path.join(root, 'repo'),
        }),
      (error: Error) => {
        assert.match(error.message, /blocked output/);
        assert.doesNotMatch(error.message, new RegExp(credential));
        return true;
      },
    );
    assert.equal(fs.existsSync(path.join(root, 'artifacts')), false);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('rejects credentials split across artifact copy chunks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-secret-report-'));
  const workspace = path.join(root, 'repo');
  const report = path.join(workspace, 'test-results');
  const credential = 'github-secret-value';
  try {
    fs.mkdirSync(report, { recursive: true });
    fs.writeFileSync(
      path.join(report, 'output.txt'),
      `${'x'.repeat(64 * 1024 - 7)}${credential}`,
    );
    assert.throws(
      () =>
        stageAgentArtifacts({
          directory: path.join(root, 'artifacts'),
          patch: '',
          prohibitedExactValues: [credential],
          repositoryStatus: '',
          supervisor: supervisor(),
          workspace,
        }),
      (error: Error) => {
        assert.match(error.message, /blocked output/);
        assert.doesNotMatch(error.message, new RegExp(credential));
        return true;
      },
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('rejects credentials in artifact archive path names', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-secret-path-'));
  const workspace = path.join(root, 'repo');
  const credential = 'runtime-secret-value';
  try {
    const leakedPath = path.join(
      workspace,
      'test-results',
      credential,
      'output.txt',
    );
    fs.mkdirSync(path.dirname(leakedPath), { recursive: true });
    fs.writeFileSync(leakedPath, 'otherwise safe');
    assert.throws(
      () =>
        stageAgentArtifacts({
          directory: path.join(root, 'artifacts'),
          patch: '',
          prohibitedExactValues: [credential],
          repositoryStatus: '',
          supervisor: supervisor(),
          workspace,
        }),
      (error: Error) => {
        assert.match(error.message, /blocked output/);
        assert.doesNotMatch(error.message, new RegExp(credential));
        return true;
      },
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('bounds zero-byte artifact trees by entry count', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-entries-'));
  try {
    const workspace = path.join(root, 'repo');
    const report = path.join(workspace, 'test-results');
    fs.mkdirSync(report, { recursive: true });
    for (let index = 0; index < 8; index += 1) {
      fs.writeFileSync(path.join(report, `${index}.txt`), '');
    }

    const staged = stageAgentArtifacts({
      directory: path.join(root, 'artifacts'),
      maximumEntries: 3,
      patch: '',
      repositoryStatus: '',
      supervisor: supervisor(),
      workspace,
    });

    assert.equal(staged.skippedFileCount, 1);
    assert.equal(staged.truncationManifest, 'artifact-truncation.json');
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(staged.directory, staged.truncationManifest!),
        'utf8',
      ),
    ) as Record<string, unknown>;
    assert.equal(manifest.skippedFileCount, 1);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('uses the API archive path and depth limits while staging', () => {
  const root = path.resolve('/staging');
  assert.equal(
    isArtifactArchivePathCompatible(
      root,
      path.join(root, 'test-results', 'trace.zip'),
    ),
    true,
  );
  assert.equal(
    isArtifactArchivePathCompatible(
      root,
      path.join(root, ...Array.from({ length: 33 }, () => 'level')),
    ),
    false,
  );
  assert.equal(
    isArtifactArchivePathCompatible(
      root,
      path.join(
        root,
        ...Array.from(
          { length: 20 },
          (_, index) => `${String(index).padStart(2, '0')}-${'x'.repeat(50)}`,
        ),
      ),
    ),
    false,
  );
});

test('skips files that exceed the API archive depth or per-file limits', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-api-limits-'));
  try {
    const workspace = path.join(root, 'repo');
    const testResults = path.join(workspace, 'test-results');
    fs.mkdirSync(testResults, { recursive: true });
    const oversized = path.join(testResults, 'oversized.webm');
    fs.writeFileSync(oversized, '');
    fs.truncateSync(oversized, 64 * 1024 * 1024 + 1);

    let deepDirectory = testResults;
    for (let index = 0; index < 32; index += 1) {
      deepDirectory = path.join(deepDirectory, `level-${index}`);
    }
    fs.mkdirSync(deepDirectory, { recursive: true });
    fs.writeFileSync(path.join(deepDirectory, 'trace.zip'), 'trace');

    const staged = stageAgentArtifacts({
      directory: path.join(root, 'artifacts'),
      patch: '',
      repositoryStatus: '',
      supervisor: supervisor(),
      workspace,
    });

    assert.equal(
      fs.existsSync(
        path.join(staged.directory, 'test-results', 'oversized.webm'),
      ),
      false,
    );
    assert.equal(
      fs.existsSync(
        path.join(
          staged.directory,
          path.relative(workspace, deepDirectory),
          'trace.zip',
        ),
      ),
      false,
    );
    assert.ok(staged.skippedFileCount >= 2);
    assert.equal(staged.truncationManifest, 'artifact-truncation.json');
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('uploads a gzip archive and returns stable artifact URLs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-upload-'));
  try {
    const workspace = path.join(root, 'repo');
    fs.mkdirSync(path.join(workspace, 'playwright-report'), {
      recursive: true,
    });
    fs.writeFileSync(path.join(root, 'not-an-artifact'), 'unsafe');
    fs.symlinkSync(
      path.join(root, 'not-an-artifact'),
      path.join(workspace, 'playwright-report', 'skipped-link'),
    );
    const staged = stageAgentArtifacts({
      directory: path.join(root, 'artifacts'),
      patch: 'patch',
      repositoryStatus: ' M a\n',
      supervisor: supervisor(),
      workspace,
    });
    let request: { input: string; init?: RequestInit } | undefined;
    const refs = await uploadAgentArtifacts(
      staged,
      {
        cloudProvider: 'LOCAL_RUNNER',
        editorApiUrl: 'https://editor.example/base',
        executionAuthToken: 'secret-token',
        nodeId: 'node-1',
        testId: 'test-1',
      },
      async (input, init) => {
        request = { input: String(input), init };
        return new Response(JSON.stringify({ output: {} }), { status: 200 });
      },
    );

    assert.equal(
      request?.input,
      'https://editor.example/api/outputs/test-1/node-1',
    );
    assert.equal(
      new Headers(request?.init?.headers).get('x-execution-token'),
      'secret-token',
    );
    assert.ok(request?.init?.body instanceof Uint8Array);
    assert.equal(
      refs.validationHistory,
      '/outputs/test-1/node-1/validation/history.json',
    );
    assert.equal(refs.artifactsTruncated, true);
    assert.equal(
      refs.artifactTruncation,
      '/outputs/test-1/node-1/artifact-truncation.json',
    );
    assert.equal(refs.playwrightReport, undefined);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('prioritizes coverage and never publishes a skipped coverage path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-coverage-'));
  try {
    const workspace = path.join(root, 'repo');
    const output = path.join(root, 'artifacts');
    fs.mkdirSync(path.join(workspace, 'coverage'), { recursive: true });
    fs.mkdirSync(path.join(workspace, 'playwright-report'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(workspace, 'coverage', 'coverage-summary.json'),
      JSON.stringify({ total: { lines: { pct: 90 } } }),
    );
    fs.writeFileSync(
      path.join(workspace, 'playwright-report', 'large.txt'),
      'x'.repeat(3_800),
    );
    const run = supervisor();
    run.validation = {
      artifacts: {
        coverage: 'coverage/coverage-summary.json',
        traces: [],
      },
    } as unknown as ValidationResult;

    const staged = stageAgentArtifacts({
      directory: output,
      maximumBytes: 4_096,
      patch: 'patch',
      repositoryStatus: '',
      supervisor: run,
      workspace,
    });

    assert.equal(
      staged.relativeCoveragePath,
      path.join('coverage', 'coverage-summary.json'),
    );
    assert.equal(
      fs.existsSync(path.join(output, staged.relativeCoveragePath!)),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(output, 'playwright-report', 'large.txt')),
      false,
    );

    fs.writeFileSync(
      path.join(workspace, 'coverage', 'coverage-summary.json'),
      'x'.repeat(5_000),
    );
    const skipped = stageAgentArtifacts({
      directory: output,
      maximumBytes: 4_096,
      patch: 'patch',
      repositoryStatus: '',
      supervisor: run,
      workspace,
    });
    assert.equal(skipped.relativeCoveragePath, undefined);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});
