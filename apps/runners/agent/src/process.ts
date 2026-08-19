import { spawn } from 'child_process';

export interface ProcessResult {
  code: number;
  stderr: string;
  stdout: string;
}

export function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; stream?: boolean } = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      const value = chunk.toString();
      stdout += value;
      if (options.stream) process.stdout.write(value);
    });
    child.stderr.on('data', (chunk) => {
      const value = chunk.toString();
      stderr += value;
      if (options.stream) process.stderr.write(value);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stderr, stdout }));
  });
}
