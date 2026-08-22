import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { resolveOutputDirectory } from './output-paths';

const TAR_BLOCK_BYTES = 512;
const TAR_END_BYTES = TAR_BLOCK_BYTES * 2;

export const DEFAULT_OUTPUT_ARCHIVE_LIMITS = Object.freeze({
  maxCompressedBytes: 100 * 1024 * 1024,
  maxDepth: 32,
  maxEntries: 20_000,
  maxFileBytes: 64 * 1024 * 1024,
  maxMetadataBytes: 1024 * 1024,
  maxPathBytes: 1024,
  maxPathSegmentBytes: 255,
  maxUncompressedBytes: 256 * 1024 * 1024,
});

export type OutputArchiveLimits = typeof DEFAULT_OUTPUT_ARCHIVE_LIMITS;

type ParsedArchiveEntry = {
  contents?: Buffer;
  mode: number;
  path: string;
  type: 'directory' | 'file';
};

type ParsedPaxAttributes = Record<string, string>;

export class OutputArchiveValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutputArchiveValidationError';
  }
}

function validationError(message: string): never {
  throw new OutputArchiveValidationError(message);
}

function decodeUtf8(value: Buffer, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value);
  } catch {
    return validationError(`${label} is not valid UTF-8.`);
  }
}

function readTarString(header: Buffer, start: number, length: number): string {
  const field = header.subarray(start, start + length);
  const nulIndex = field.indexOf(0);
  return decodeUtf8(
    nulIndex === -1 ? field : field.subarray(0, nulIndex),
    'Tar header path',
  );
}

function readTarNumber(
  header: Buffer,
  start: number,
  length: number,
  label: string,
): number {
  const field = header.subarray(start, start + length);
  if ((field[0] & 0x80) !== 0) {
    return validationError(`${label} uses an unsupported binary encoding.`);
  }
  const nulIndex = field.indexOf(0);
  const text = field
    .subarray(0, nulIndex === -1 ? field.length : nulIndex)
    .toString('ascii')
    .trim();
  if (text === '') return 0;
  if (!/^[0-7]+$/.test(text)) {
    return validationError(`${label} is not a valid octal number.`);
  }
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) {
    return validationError(`${label} is outside the supported range.`);
  }
  return value;
}

function headerIsEmpty(header: Buffer): boolean {
  for (const byte of header) {
    if (byte !== 0) return false;
  }
  return true;
}

function validateTarChecksum(header: Buffer): void {
  const expected = readTarNumber(header, 148, 8, 'Tar header checksum');
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  if (actual !== expected) {
    validationError('Tar header checksum is invalid.');
  }
}

function parsePaxAttributes(data: Buffer): ParsedPaxAttributes {
  const attributes: ParsedPaxAttributes = {};
  let offset = 0;
  while (offset < data.length) {
    const spaceIndex = data.indexOf(0x20, offset);
    if (spaceIndex === -1) {
      return validationError('PAX header record length is missing.');
    }
    const lengthText = data.subarray(offset, spaceIndex).toString('ascii');
    if (!/^[1-9][0-9]*$/.test(lengthText)) {
      return validationError('PAX header record length is invalid.');
    }
    const recordLength = Number.parseInt(lengthText, 10);
    const recordEnd = offset + recordLength;
    if (
      !Number.isSafeInteger(recordLength) ||
      recordEnd > data.length ||
      recordEnd <= spaceIndex + 1 ||
      data[recordEnd - 1] !== 0x0a
    ) {
      return validationError('PAX header record is malformed.');
    }
    const record = decodeUtf8(
      data.subarray(spaceIndex + 1, recordEnd - 1),
      'PAX header record',
    );
    const equalsIndex = record.indexOf('=');
    if (equalsIndex <= 0) {
      return validationError('PAX header record has no attribute name.');
    }
    const key = record.slice(0, equalsIndex);
    if (Object.hasOwn(attributes, key)) {
      return validationError(`PAX attribute "${key}" is duplicated.`);
    }
    attributes[key] = record.slice(equalsIndex + 1);
    offset = recordEnd;
  }
  return attributes;
}

function parsePaxSize(value: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    return validationError('PAX file size is invalid.');
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) {
    return validationError('PAX file size is outside the supported range.');
  }
  return parsed;
}

function normalizeArchivePath(
  archivePath: string,
  entryType: 'directory' | 'file',
  limits: OutputArchiveLimits,
): string | null {
  if (archivePath.includes('\0') || archivePath.includes('\\')) {
    return validationError('Archive entry path contains an unsafe character.');
  }
  if (/^[A-Za-z]:/.test(archivePath) || archivePath.startsWith('/')) {
    return validationError('Archive entry path must be relative.');
  }

  let normalized = archivePath;
  while (normalized.startsWith('./')) normalized = normalized.slice(2);
  while (normalized.endsWith('/')) normalized = normalized.slice(0, -1);

  if (normalized === '' || normalized === '.') {
    if (entryType === 'directory') return null;
    return validationError('Archive file entry has an empty path.');
  }
  if (Buffer.byteLength(normalized, 'utf8') > limits.maxPathBytes) {
    return validationError('Archive entry path is too long.');
  }

  const segments = normalized.split('/');
  if (
    segments.some(
      (segment) =>
        segment === '' ||
        segment === '.' ||
        segment === '..' ||
        Buffer.byteLength(segment, 'utf8') > limits.maxPathSegmentBytes ||
        Array.from(segment).some((character) => {
          const codePoint = character.codePointAt(0) as number;
          return codePoint <= 0x1f || codePoint === 0x7f;
        }),
    )
  ) {
    return validationError('Archive entry path contains an unsafe segment.');
  }
  if (segments.length > limits.maxDepth) {
    return validationError('Archive entry path exceeds the depth limit.');
  }
  return segments.join('/');
}

function safeMode(mode: number, entryType: 'directory' | 'file'): number {
  const permissions = mode & 0o777;
  return permissions || (entryType === 'directory' ? 0o755 : 0o644);
}

function limitsWithDefaults(
  limits: Partial<OutputArchiveLimits> | undefined,
): OutputArchiveLimits {
  const resolved = { ...DEFAULT_OUTPUT_ARCHIVE_LIMITS, ...limits };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      validationError(`Archive limit ${name} must be a positive integer.`);
    }
  }
  return resolved;
}

export function parseOutputArchive(
  archive: Buffer,
  configuredLimits?: Partial<OutputArchiveLimits>,
): ParsedArchiveEntry[] {
  const limits = limitsWithDefaults(configuredLimits);
  if (!Buffer.isBuffer(archive) || archive.length === 0) {
    return validationError('Output archive must be a non-empty Buffer.');
  }
  if (archive.length > limits.maxCompressedBytes) {
    return validationError('Output archive exceeds the compressed size limit.');
  }
  if (archive.length < 2 || archive[0] !== 0x1f || archive[1] !== 0x8b) {
    return validationError('Output archive must be gzip encoded.');
  }

  let tar: Buffer;
  try {
    tar = gunzipSync(archive, {
      maxOutputLength: limits.maxUncompressedBytes,
    });
  } catch {
    return validationError(
      'Output archive is malformed or exceeds the uncompressed size limit.',
    );
  }
  if (tar.length < TAR_END_BYTES || tar.length % TAR_BLOCK_BYTES !== 0) {
    return validationError('Tar archive has an invalid length.');
  }

  const entries: ParsedArchiveEntry[] = [];
  const claimedPaths = new Map<string, 'directory' | 'file'>();
  const pathsWithDescendants = new Set<string>();
  let globalPax: ParsedPaxAttributes = {};
  let pendingPax: ParsedPaxAttributes | undefined;
  let pendingLongPath: string | undefined;
  let offset = 0;
  let headerCount = 0;
  let totalFileBytes = 0;
  let foundEnd = false;

  while (offset + TAR_BLOCK_BYTES <= tar.length) {
    const header = tar.subarray(offset, offset + TAR_BLOCK_BYTES);
    if (headerIsEmpty(header)) {
      if (
        offset + TAR_END_BYTES > tar.length ||
        !headerIsEmpty(
          tar.subarray(offset + TAR_BLOCK_BYTES, offset + TAR_END_BYTES),
        )
      ) {
        return validationError('Tar archive is missing its second end block.');
      }
      for (let index = offset + TAR_END_BYTES; index < tar.length; index += 1) {
        if (tar[index] !== 0) {
          return validationError('Tar archive contains data after its end.');
        }
      }
      foundEnd = true;
      break;
    }

    headerCount += 1;
    if (headerCount > limits.maxEntries) {
      return validationError('Tar archive exceeds the entry count limit.');
    }
    validateTarChecksum(header);

    const headerSize = readTarNumber(header, 124, 12, 'Tar entry size');
    const paddedSize =
      Math.ceil(headerSize / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
    const dataStart = offset + TAR_BLOCK_BYTES;
    const dataEnd = dataStart + headerSize;
    const nextOffset = dataStart + paddedSize;
    if (
      !Number.isSafeInteger(nextOffset) ||
      dataEnd > tar.length ||
      nextOffset > tar.length
    ) {
      return validationError('Tar entry data is truncated.');
    }

    const rawType = header[156];
    const type = rawType === 0 ? '0' : String.fromCharCode(rawType);
    const data = tar.subarray(dataStart, dataEnd);

    if (type === 'x' || type === 'g') {
      if (headerSize > limits.maxMetadataBytes) {
        return validationError('PAX metadata exceeds the size limit.');
      }
      const attributes = parsePaxAttributes(data);
      if (Object.hasOwn(attributes, 'linkpath')) {
        return validationError('Archive links are not allowed.');
      }
      if (type === 'g') {
        if (
          Object.hasOwn(attributes, 'path') ||
          Object.hasOwn(attributes, 'size')
        ) {
          return validationError(
            'Global PAX path and size overrides are not allowed.',
          );
        }
        globalPax = { ...globalPax, ...attributes };
      } else {
        if (pendingPax) {
          return validationError('Multiple PAX headers precede one entry.');
        }
        pendingPax = attributes;
      }
      offset = nextOffset;
      continue;
    }

    if (type === 'L') {
      if (pendingLongPath || headerSize > limits.maxPathBytes + 1) {
        return validationError('GNU long path metadata is invalid.');
      }
      const withoutTrailingNul =
        data.length > 0 && data[data.length - 1] === 0
          ? data.subarray(0, data.length - 1)
          : data;
      if (withoutTrailingNul.includes(0)) {
        return validationError('GNU long path contains an embedded NUL.');
      }
      pendingLongPath = decodeUtf8(withoutTrailingNul, 'GNU long path');
      offset = nextOffset;
      continue;
    }

    if (type !== '0' && type !== '5') {
      return validationError(
        `Tar entry type ${JSON.stringify(type)} is not allowed.`,
      );
    }

    const entryType = type === '5' ? 'directory' : 'file';
    const headerName = readTarString(header, 0, 100);
    const headerPrefix = readTarString(header, 345, 155);
    const pax = { ...globalPax, ...pendingPax };
    const archivePath =
      pax.path ??
      pendingLongPath ??
      (headerPrefix ? `${headerPrefix}/${headerName}` : headerName);
    const normalizedPath = normalizeArchivePath(archivePath, entryType, limits);

    if (Object.hasOwn(pax, 'size')) {
      const paxSize = parsePaxSize(pax.size);
      if (paxSize !== headerSize) {
        return validationError('PAX and tar header file sizes do not match.');
      }
    }
    pendingPax = undefined;
    pendingLongPath = undefined;

    if (entryType === 'directory' && headerSize !== 0) {
      return validationError('Tar directory entry contains data.');
    }
    if (entryType === 'file') {
      if (headerSize > limits.maxFileBytes) {
        return validationError('Tar entry exceeds the per-file size limit.');
      }
      totalFileBytes += headerSize;
      if (totalFileBytes > limits.maxUncompressedBytes) {
        return validationError('Tar files exceed the total size limit.');
      }
    }

    if (normalizedPath !== null) {
      if (claimedPaths.has(normalizedPath)) {
        return validationError('Tar archive contains a duplicate path.');
      }
      const segments = normalizedPath.split('/');
      for (let index = 1; index < segments.length; index += 1) {
        const ancestor = segments.slice(0, index).join('/');
        if (claimedPaths.get(ancestor) === 'file') {
          return validationError('Tar file path is used as a directory.');
        }
        pathsWithDescendants.add(ancestor);
      }
      if (entryType === 'file' && pathsWithDescendants.has(normalizedPath)) {
        return validationError('Tar directory path is replaced by a file.');
      }
      claimedPaths.set(normalizedPath, entryType);
      entries.push({
        ...(entryType === 'file' ? { contents: data } : {}),
        mode: safeMode(
          readTarNumber(header, 100, 8, 'Tar entry mode'),
          entryType,
        ),
        path: normalizedPath,
        type: entryType,
      });
    }

    offset = nextOffset;
  }

  if (!foundEnd) {
    return validationError('Tar archive is missing its end blocks.');
  }
  if (pendingPax || pendingLongPath) {
    return validationError('Tar archive ends after extension metadata.');
  }
  return entries;
}

function isContainedPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}

function ensureDirectoryWithoutLinks(
  directory: string,
  containmentRoot: string,
): void {
  const root = path.resolve(containmentRoot);
  const target = path.resolve(directory);
  if (!isContainedPath(root, target)) {
    validationError('Output directory escapes the configured root.');
  }

  const relative = path.relative(root, target);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) {
      fs.mkdirSync(current);
    }
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      validationError('Output directory contains a symbolic link.');
    }
  }
}

function extractEntries(entries: ParsedArchiveEntry[], staging: string): void {
  for (const entry of entries) {
    const target = path.resolve(staging, ...entry.path.split('/'));
    if (!isContainedPath(staging, target) || target === staging) {
      validationError('Archive entry escapes the staging directory.');
    }
    if (entry.type === 'directory') {
      fs.mkdirSync(target, { mode: entry.mode, recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.contents as Buffer, {
      flag: 'wx',
      mode: entry.mode,
    });
  }
}

export function extractOutputArchiveAtomically(
  archive: Buffer,
  outputRoot: string,
  testId: string,
  nodeId: string,
  configuredLimits?: Partial<OutputArchiveLimits>,
): string {
  const entries = parseOutputArchive(archive, configuredLimits);
  const outputsDir = resolveOutputDirectory(outputRoot, testId, nodeId);
  const resolvedRoot = path.resolve(outputRoot);
  fs.mkdirSync(resolvedRoot, { recursive: true });
  const rootStat = fs.lstatSync(resolvedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    validationError('Configured output root must be a real directory.');
  }
  const realRoot = fs.realpathSync(resolvedRoot);
  const testDirectory = path.dirname(outputsDir);
  ensureDirectoryWithoutLinks(testDirectory, resolvedRoot);
  if (!isContainedPath(realRoot, fs.realpathSync(testDirectory))) {
    validationError('Output directory escapes the configured root.');
  }

  if (fs.existsSync(outputsDir)) {
    const existing = fs.lstatSync(outputsDir);
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      validationError('Existing node output path is not a real directory.');
    }
  }

  const staging = fs.mkdtempSync(path.join(testDirectory, '.output-upload-'));
  let stagingExists = true;
  let backup: string | undefined;
  let backupExists = false;
  let operationError: unknown;
  try {
    extractEntries(entries, staging);

    if (fs.existsSync(outputsDir)) {
      backup = path.join(
        testDirectory,
        `.output-backup-${process.pid}-${randomUUID()}`,
      );
      fs.renameSync(outputsDir, backup);
      backupExists = true;
    }
    fs.renameSync(staging, outputsDir);
    stagingExists = false;
  } catch (error) {
    operationError = error;
  }

  const cleanupErrors: unknown[] = [];
  if (operationError && backup && backupExists && !fs.existsSync(outputsDir)) {
    try {
      fs.renameSync(backup, outputsDir);
      backupExists = false;
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (stagingExists) {
    try {
      fs.rmSync(staging, { force: true, recursive: true });
      stagingExists = false;
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (backup && backupExists && fs.existsSync(backup)) {
    try {
      if (operationError && !fs.existsSync(outputsDir)) {
        fs.renameSync(backup, outputsDir);
      } else {
        fs.rmSync(backup, { force: true, recursive: true });
      }
      backupExists = false;
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (operationError) {
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [operationError, ...cleanupErrors],
        'Output archive replacement and cleanup failed.',
      );
    }
    throw operationError;
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      'Output archive cleanup failed after replacement.',
    );
  }
  return outputsDir;
}
