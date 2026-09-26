import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import * as yauzl from 'yauzl';

export async function extractTestSuite(contents: Buffer, directory: string) {
  if (contents.length > 50 * 1024 * 1024) throw new Error('ZIP exceeds 50 MB.');
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.fromBuffer(
      contents,
      { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (error, file) => (error ? reject(error) : resolve(file!)),
    ),
  );
  let total = 0;
  let count = 0;
  const seen = new Set<string>();
  await new Promise<void>((resolve, reject) => {
    const fail = (error: unknown) => {
      zip.close();
      reject(error);
    };
    zip.on('error', fail);
    zip.on('end', resolve);
    zip.on('entry', (entry: yauzl.Entry) => {
      void (async () => {
        const name = entry.fileName;
        const kind = (entry.externalFileAttributes >>> 16) & 0xf000;
        const parts = name.replace(/\/$/, '').split('/');
        if (
          ++count > 10000 ||
          name.length > 1024 ||
          parts.length > 32 ||
          parts.some(
            (p) =>
              !p ||
              p === '.' ||
              p === '..' ||
              p === 'node_modules' ||
              p === '.git',
          ) ||
          /[\\:]/.test(name) ||
          [...name].some((char) => char.charCodeAt(0) < 32) ||
          (kind !== 0 && kind !== 0x8000 && kind !== 0x4000) ||
          seen.has(name)
        )
          throw new Error(
            'ZIP contains unsafe, duplicate, or unsupported entries. Exclude node_modules and .git.',
          );
        seen.add(name);
        total += entry.uncompressedSize;
        if (
          total > 200 * 1024 * 1024 ||
          entry.uncompressedSize > 50 * 1024 * 1024
        )
          throw new Error('Expanded test suite exceeds size limits.');
        const destination = path.join(directory, name);
        if (name.endsWith('/')) fs.mkdirSync(destination, { recursive: true });
        else {
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          const input = await new Promise<NodeJS.ReadableStream>(
            (resolve, reject) =>
              zip.openReadStream(entry, (error, stream) =>
                error ? reject(error) : resolve(stream!),
              ),
          );
          await pipeline(
            input,
            fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
          );
        }
        zip.readEntry();
      })().catch(fail);
    });
    zip.readEntry();
  });
}

export async function prepareUploadedSuite(data: Record<string, any>) {
  const suite = data.testSuite;
  if (
    !suite ||
    typeof suite.id !== 'string' ||
    typeof suite.sha256 !== 'string'
  )
    throw new Error('Upload a test ZIP before running this node.');
  const url = new URL(
    `/api/test-suites/${encodeURIComponent(suite.id)}/execution/${encodeURIComponent(data.testId)}`,
    data.editorApiUrl,
  );
  const response = await fetch(url, {
    headers: { 'x-execution-token': data.executionAuthToken },
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok || !response.body)
    throw new Error(`Test suite download failed (${response.status}).`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body as any) {
    size += chunk.length;
    if (size > 50 * 1024 * 1024)
      throw new Error('Test suite download exceeds 50 MB.');
    chunks.push(chunk);
  }
  const contents = Buffer.concat(chunks);
  if (createHash('sha256').update(contents).digest('hex') !== suite.sha256)
    throw new Error('Uploaded test suite checksum mismatch.');
  // The runner's WORKDIR is /app. Match GitHub's /app/repo in every
  // isolated container so shard reports contain the same test root.
  const directory = path.join(process.cwd(), 'repo');
  // Fail rather than overwrite an existing workspace.
  fs.mkdirSync(directory);
  try {
    await extractTestSuite(contents, directory);
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return directory;
}
