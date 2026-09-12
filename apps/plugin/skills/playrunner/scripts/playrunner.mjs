#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { constants } from 'node:os';

const { config } = JSON.parse(
  readFileSync(new URL('../runtime.json', import.meta.url), 'utf8'),
);

// Keep the CLI in npm's cache, outside the installed plugin and user's project.
const child = spawn(
  'npx',
  [
    '--yes',
    `--package=playrunner@${config.playrunnerVersion}`,
    '--',
    'playrunner',
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit' },
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', (error) => {
  console.error(
    `Unable to launch Playrunner. Check Node.js and npm: ${error.message}`,
  );
  process.exitCode = 2;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? 128 + (constants.signals[signal] ?? 1);
});
