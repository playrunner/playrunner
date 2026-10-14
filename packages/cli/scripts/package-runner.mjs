import fs from 'node:fs/promises';
import path from 'node:path';
import { URL, fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const target = path.join(root, 'packages/cli/dist/runner');
await fs.rm(target, { recursive: true, force: true });
await fs.mkdir(target, { recursive: true });
for (const directory of ['playwright', 'shared']) {
  await fs.cp(
    path.join(root, 'apps/runners', directory),
    path.join(target, directory),
    {
      recursive: true,
      filter: (source) =>
        !source
          .split(path.sep)
          .some((part) =>
            ['node_modules', 'dist', '.cache', 'test-results'].includes(part),
          ) && !/\.test\.ts$|\.env(?:\.|$)/.test(source),
    },
  );
}
await fs.copyFile(
  path.join(root, 'config/playwright-runner-versions.json'),
  path.join(target, 'versions.json'),
);
