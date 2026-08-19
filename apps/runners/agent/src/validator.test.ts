import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validatePlaywrightTests } from './validator';

test('reports an empty repository as an untested critical path', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'validator-empty-'));
  try {
    const result = await validatePlaywrightTests(directory, {
      failOn: ['untested_critical_path'],
      runTests: false,
    });
    assert.equal(result.passed, false);
    assert.ok(
      result.violations.some(
        (violation) => violation.code === 'untested_critical_path',
      ),
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});
