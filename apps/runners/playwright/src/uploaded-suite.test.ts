import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractTestSuite } from './uploaded-suite';

const fixture = Buffer.from(
  'UEsDBBQAAAAAACdpOl2GphA2BQAAAAUAAAAIAAAAc2FmZS50eHRoZWxsb1BLAQIUAxQAAAAAACdpOl2GphA2BQAAAAUAAAAIAAAAAAAAAAAAAACAAQAAAABzYWZlLnR4dFBLBQYAAAAAAQABADYAAAArAAAAAAA=',
  'base64',
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
