import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { extractTestSuite, prepareUploadedSuite } from './uploaded-suite';

const fixture = Buffer.from(
  'UEsDBBQAAAAAACdpOl2GphA2BQAAAAUAAAAIAAAAc2FmZS50eHRoZWxsb1BLAQIUAxQAAAAAACdpOl2GphA2BQAAAAUAAAAIAAAAAAAAAAAAAACAAQAAAABzYWZlLnR4dFBLBQYAAAAAAQABADYAAAArAAAAAAA=',
  'base64',
);
test('uses the same repo path in fresh runners and refuses an existing workspace', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-runner-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.mock.method(process, 'cwd', () => root);
  t.mock.method(globalThis, 'fetch', async () => new Response(fixture));
  const data = {
    testSuite: {
      id: 'suite',
      sha256: createHash('sha256').update(fixture).digest('hex'),
    },
    testId: 'execution',
    editorApiUrl: 'http://localhost',
  };
  const first = await prepareUploadedSuite(data);
  assert.equal(first, path.join(root, 'repo'));
  await assert.rejects(prepareUploadedSuite(data), /EEXIST/);
  assert.equal(fs.readFileSync(path.join(first, 'safe.txt'), 'utf8'), 'hello');
  fs.rmSync(first, { recursive: true });
  const second = await prepareUploadedSuite(data);
  assert.equal(second, first);
});

test('removes only its newly created workspace when extraction fails', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-runner-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.mock.method(process, 'cwd', () => root);
  const invalid = Buffer.from('invalid zip');
  t.mock.method(globalThis, 'fetch', async () => new Response(invalid));
  await assert.rejects(
    prepareUploadedSuite({
      testSuite: {
        id: 'suite',
        sha256: createHash('sha256').update(invalid).digest('hex'),
      },
      testId: 'execution',
      editorApiUrl: 'http://localhost',
    }),
  );
  assert.equal(fs.existsSync(path.join(root, 'repo')), false);
});

test(
  'uploaded suites produce mergeable real shard reports without merge overrides',
  { timeout: 60000 },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-shards-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    t.mock.method(process, 'cwd', () => root);
    t.mock.method(globalThis, 'fetch', async () => new Response(fixture));
    const blobs = path.join(root, 'blobs');
    fs.mkdirSync(blobs);
    const run = (cwd: string, args: string[], env: NodeJS.ProcessEnv) => {
      const result = spawnSync(
        process.execPath,
        [require.resolve('@playwright/test/cli'), ...args],
        {
          cwd,
          encoding: 'utf8',
          timeout: 20000,
          env: { ...process.env, ...env },
        },
      );
      assert.ifError(result.error);
      return result;
    };
    for (const shard of [1, 2]) {
      const directory = await prepareUploadedSuite({
        testSuite: {
          id: 'suite',
          sha256: createHash('sha256').update(fixture).digest('hex'),
        },
        testId: 'execution',
        editorApiUrl: 'http://localhost',
      });
      fs.writeFileSync(
        path.join(directory, 'playwright.config.cjs'),
        'module.exports = { fullyParallel: true, workers: 1, retries: 0 };',
      );
      fs.writeFileSync(
        path.join(directory, 'example.spec.cjs'),
        `const { test, expect } = require(${JSON.stringify(require.resolve('@playwright/test'))});\n` +
          'test("passing case", () => expect(1).toBe(1));\n' +
          'test("failing case", () => expect(1).toBe(2));\n',
      );
      const result = run(
        directory,
        ['test', '--reporter=blob', `--shard=${shard}/2`],
        {
          PLAYWRIGHT_BLOB_OUTPUT_FILE: path.join(blobs, `shard-${shard}.zip`),
        },
      );
      assert.equal(
        result.status,
        shard === 1 ? 0 : 1,
        result.stdout + result.stderr,
      );
      // Each isolated runner starts with an empty filesystem at the same path.
      fs.rmSync(directory, { recursive: true });
    }
    const reportPath = path.join(root, 'report.json');
    const merged = run(root, ['merge-reports', '--reporter=html,json', blobs], {
      PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath,
      PLAYWRIGHT_HTML_OUTPUT_DIR: path.join(root, 'html'),
      PLAYWRIGHT_HTML_OPEN: 'never',
    });
    assert.equal(merged.status, 0, merged.stdout + merged.stderr);
    assert.ok(fs.existsSync(path.join(root, 'html', 'index.html')));
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(report.stats.expected, 1);
    assert.equal(report.stats.unexpected, 1);
    assert.equal(report.stats.skipped, 0);
    assert.equal(report.stats.flaky, 0);
    assert.deepEqual(
      report.suites
        .flatMap((suite: any) => suite.specs.map((spec: any) => spec.title))
        .sort(),
      ['failing case', 'passing case'],
    );
  },
);

test('extracts a real ZIP and rejects traversal, symlinks, oversized entries and malformed data', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-extraction-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await extractTestSuite(fixture, directory);
  assert.equal(
    fs.readFileSync(path.join(directory, 'safe.txt'), 'utf8'),
    'hello',
  );
  const traversal = Buffer.from(
    fixture.toString('latin1').replaceAll('safe.txt', '../x.txt'),
    'latin1',
  );
  await assert.rejects(
    extractTestSuite(traversal, directory),
    /invalid relative path/,
  );
  const symlink = Buffer.from(fixture);
  const central = symlink.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  symlink.writeUInt32LE(0xa0000000, central + 38);
  await assert.rejects(extractTestSuite(symlink, directory), /unsafe/);
  const oversized = Buffer.from(fixture);
  oversized.writeUInt32LE(60 * 1024 * 1024, central + 24);
  await assert.rejects(extractTestSuite(oversized, directory));
  await assert.rejects(extractTestSuite(Buffer.from('not a zip'), directory));
});
