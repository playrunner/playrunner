import fs from 'node:fs';
import path from 'node:path';

/** Copy the explicitly mounted checkout, never execute against the host mount. */
export function prepareLocalWorkspace(
  source: string,
  destination: string,
  folder: unknown,
): string {
  const relative =
    typeof folder === 'string' ? folder.replace(/^\/+|\/+$/g, '') : '';
  if (relative.split(/[\\/]/).includes('..') || relative.includes('\\'))
    throw new Error('Invalid local test folder.');
  fs.mkdirSync(destination, { recursive: true });
  const excluded = new Set([
    '.git',
    'node_modules',
    'playwright-report',
    'test-results',
    'blob-report',
  ]);
  const copy = (from: string, to: string) => {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      if (excluded.has(entry.name) || entry.isSymbolicLink()) continue;
      const origin = path.join(from, entry.name);
      const target = path.join(to, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(target, { recursive: true });
        copy(origin, target);
      } else if (entry.isFile()) fs.copyFileSync(origin, target);
    }
  };
  copy(source, destination);
  const working = path.resolve(destination, relative);
  if (!fs.statSync(working).isDirectory())
    throw new Error('Local test folder is not a directory.');
  return working;
}
