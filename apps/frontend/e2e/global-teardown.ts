import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export default async function globalTeardown() {
  // Only remove the dedicated test runner; leave the developer runner alone.
  const { stdout } = await exec('docker', [
    'ps',
    '-aq',
    '--filter',
    'name=^playrunner-orchestrator-e2e$',
  ]);
  if (stdout.trim())
    await exec('docker', ['rm', '-f', 'playrunner-orchestrator-e2e']);
}
