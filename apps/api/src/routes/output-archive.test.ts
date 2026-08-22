import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import {
  extractOutputArchiveAtomically,
  OutputArchiveValidationError,
  parseOutputArchive,
} from './output-archive';

type TarEntry = {
  data?: Buffer | string;
  mode?: number;
  name: string;
  prefix?: string;
  type?: string;
};

function writeString(
  target: Buffer,
  value: string,
  offset: number,
  length: number,
): void {
  const encoded = Buffer.from(value);
  assert.ok(encoded.length <= length, `${value} does not fit in tar field`);
  encoded.copy(target, offset);
}

function writeOctal(
  target: Buffer,
  value: number,
  offset: number,
  length: number,
): void {
  writeString(
    target,
    `${value.toString(8).padStart(length - 1, '0')}\0`,
    offset,
    length,
  );
}

function tarHeader(entry: TarEntry, size: number): Buffer {
  const header = Buffer.alloc(512);
  writeString(header, entry.name, 0, 100);
  writeOctal(header, entry.mode ?? 0o644, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, size, 124, 12);
  writeOctal(header, 0, 136, 12);
  header.fill(0x20, 148, 156);
  writeString(header, entry.type ?? '0', 156, 1);
  writeString(header, 'ustar\0', 257, 6);
  writeString(header, '00', 263, 2);
  if (entry.prefix) writeString(header, entry.prefix, 345, 155);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeString(header, `${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return header;
}

function rawTar(entries: TarEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(entry.data ?? '');
    parts.push(tarHeader(entry, data.length), data);
    const padding = (512 - (data.length % 512)) % 512;
    if (padding > 0) parts.push(Buffer.alloc(padding));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

function tarGzip(entries: TarEntry[]): Buffer {
  return gzipSync(rawTar(entries));
}

function paxRecord(key: string, value: string): string {
  const payload = `${key}=${value}\n`;
  let length = Buffer.byteLength(payload) + 2;
  while (true) {
    const record = `${length} ${payload}`;
    const actualLength = Buffer.byteLength(record);
    if (actualLength === length) return record;
    length = actualLength;
  }
}

test('parses and atomically installs a normal gzip tar archive', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'playrunner-output-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const oldDirectory = path.join(root, 'exec-1', 'node-1');
  fs.mkdirSync(oldDirectory, { recursive: true });
  fs.writeFileSync(path.join(oldDirectory, 'stale.txt'), 'stale');

  const archive = tarGzip([
    { mode: 0o755, name: './', type: '5' },
    { mode: 0o755, name: './playwright-report/', type: '5' },
    {
      data: '<html>report</html>',
      name: './playwright-report/index.html',
    },
    { data: 'image', name: './test-results/run/screenshot.png' },
  ]);
  const installed = extractOutputArchiveAtomically(
    archive,
    root,
    'exec-1',
    'node-1',
  );

  assert.equal(installed, oldDirectory);
  assert.equal(
    fs.readFileSync(
      path.join(installed, 'playwright-report/index.html'),
      'utf8',
    ),
    '<html>report</html>',
  );
  assert.equal(fs.existsSync(path.join(installed, 'stale.txt')), false);
  assert.deepEqual(
    fs
      .readdirSync(path.dirname(installed))
      .filter((name) => name.startsWith('.output-')),
    [],
  );
});

test('supports GNU long paths and PAX path records', () => {
  const gnuPath = `${'gnu/'.repeat(30)}result.json`;
  const paxPath = `${'pax/'.repeat(30)}trace.zip`;
  const parsed = parseOutputArchive(
    tarGzip([
      { data: `${gnuPath}\0`, name: '././@LongLink', type: 'L' },
      { data: 'gnu', name: 'placeholder' },
      { data: paxRecord('path', paxPath), name: 'PaxHeader', type: 'x' },
      { data: 'pax', name: 'placeholder-2' },
    ]),
  );

  assert.deepEqual(
    parsed.map((entry) => [entry.path, entry.contents?.toString()]),
    [
      [gnuPath, 'gnu'],
      [paxPath, 'pax'],
    ],
  );
});

test('rejects links, devices, fifos, and unsupported tar entry types', () => {
  for (const type of ['1', '2', '3', '4', '6', '7', 'K']) {
    assert.throws(
      () => parseOutputArchive(tarGzip([{ name: 'unsafe', type }])),
      OutputArchiveValidationError,
      `type ${type}`,
    );
  }
});

test('rejects absolute, traversal, backslash, and over-depth paths', () => {
  for (const name of [
    '../outside',
    '/absolute',
    'safe/../../outside',
    'safe\\..\\outside',
  ]) {
    assert.throws(
      () => parseOutputArchive(tarGzip([{ data: 'bad', name }])),
      OutputArchiveValidationError,
      name,
    );
  }
  assert.throws(
    () =>
      parseOutputArchive(
        tarGzip([{ data: 'bad', name: 'outside', prefix: '..' }]),
      ),
    OutputArchiveValidationError,
  );
  assert.throws(
    () =>
      parseOutputArchive(
        tarGzip([
          {
            data: paxRecord('path', '../pax-outside'),
            name: 'Pax',
            type: 'x',
          },
          { data: 'bad', name: 'placeholder' },
        ]),
      ),
    OutputArchiveValidationError,
  );
  assert.throws(
    () =>
      parseOutputArchive(
        tarGzip([
          { data: '/gnu-outside\0', name: '././@LongLink', type: 'L' },
          { data: 'bad', name: 'placeholder' },
        ]),
      ),
    OutputArchiveValidationError,
  );
  assert.throws(
    () =>
      parseOutputArchive(
        tarGzip([
          {
            data: paxRecord('linkpath', '../linked'),
            name: 'Pax',
            type: 'x',
          },
          { data: 'bad', name: 'placeholder' },
        ]),
      ),
    /links are not allowed/,
  );
  assert.throws(
    () =>
      parseOutputArchive(
        tarGzip([{ data: 'deep', name: 'one/two/three.txt' }]),
        { maxDepth: 2 },
      ),
    /depth limit/,
  );
  assert.throws(
    () =>
      parseOutputArchive(
        tarGzip([{ data: 'long', name: `${'x'.repeat(10)}.txt` }]),
        { maxPathSegmentBytes: 8 },
      ),
    /unsafe segment/,
  );
});

test('enforces compressed, file, uncompressed, metadata, and entry limits', () => {
  assert.throws(
    () =>
      parseOutputArchive(tarGzip([{ data: 'four', name: 'large.txt' }]), {
        maxCompressedBytes: 1,
      }),
    /compressed size limit/,
  );
  assert.throws(
    () =>
      parseOutputArchive(tarGzip([{ data: 'four', name: 'large.txt' }]), {
        maxFileBytes: 3,
      }),
    /per-file size limit/,
  );
  assert.throws(
    () =>
      parseOutputArchive(tarGzip([{ data: 'value', name: 'file.txt' }]), {
        maxUncompressedBytes: 1024,
      }),
    /uncompressed size limit/,
  );
  assert.throws(
    () =>
      parseOutputArchive(
        tarGzip([
          { data: paxRecord('path', 'renamed.txt'), name: 'Pax', type: 'x' },
          { data: 'ok', name: 'file.txt' },
        ]),
        { maxMetadataBytes: 4 },
      ),
    /metadata exceeds/,
  );
  assert.throws(
    () =>
      parseOutputArchive(
        tarGzip([
          { data: 'one', name: 'one.txt' },
          { data: 'two', name: 'two.txt' },
        ]),
        { maxEntries: 1 },
      ),
    /entry count limit/,
  );
});

test('rejects empty, non-gzip, malformed, and truncated archives', () => {
  assert.throws(() => parseOutputArchive(Buffer.alloc(0)), /non-empty Buffer/);
  assert.throws(() => parseOutputArchive(Buffer.from('not gzip')), /gzip/);

  const invalidChecksum = rawTar([{ data: 'value', name: 'file.txt' }]);
  invalidChecksum[0] ^= 1;
  assert.throws(
    () => parseOutputArchive(gzipSync(invalidChecksum)),
    /checksum/,
  );

  const missingEnd = rawTar([{ data: 'value', name: 'file.txt' }]).subarray(
    0,
    -1024,
  );
  assert.throws(
    () => parseOutputArchive(gzipSync(missingEnd)),
    /invalid length|end blocks/,
  );
  const valid = tarGzip([{ data: 'value', name: 'file.txt' }]);
  assert.throws(
    () => parseOutputArchive(valid.subarray(0, valid.length - 4)),
    /malformed/,
  );
});

test('keeps the previous output intact when a replacement is rejected', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'playrunner-output-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const liveDirectory = path.join(root, 'exec-2', 'node-2');
  fs.mkdirSync(liveDirectory, { recursive: true });
  fs.writeFileSync(path.join(liveDirectory, 'current.txt'), 'current');

  assert.throws(
    () =>
      extractOutputArchiveAtomically(
        tarGzip([
          { data: 'partial', name: 'partial.txt' },
          { data: 'escape', name: '../escape.txt' },
        ]),
        root,
        'exec-2',
        'node-2',
      ),
    OutputArchiveValidationError,
  );

  assert.equal(
    fs.readFileSync(path.join(liveDirectory, 'current.txt'), 'utf8'),
    'current',
  );
  assert.equal(fs.existsSync(path.join(root, 'escape.txt')), false);
  assert.deepEqual(
    fs
      .readdirSync(path.dirname(liveDirectory))
      .filter((name) => name.startsWith('.output-')),
    [],
  );
});
