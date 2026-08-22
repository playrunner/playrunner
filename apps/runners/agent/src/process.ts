import { spawn } from 'child_process';

export interface ProcessResult {
  code: number;
  durationMs: number;
  signal: NodeJS.Signals | null;
  stderr: string;
  stderrTruncated?: boolean;
  stdout: string;
  stdoutTruncated?: boolean;
  timedOut: boolean;
}

export function runProcess(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    gid?: number;
    input?: string;
    maxOutputBytes?: number;
    onStderr?: (value: string) => void;
    onStdout?: (value: string) => void;
    signal?: AbortSignal;
    stream?: boolean;
    timeoutMs?: number;
    uid?: number;
  } = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const useProcessGroup = process.platform !== 'win32';
    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: useProcessGroup,
      env: options.env || process.env,
      gid: options.gid,
      stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      uid: options.uid,
    });
    const maxOutputBytes = Math.max(1024, options.maxOutputBytes || 1_000_000);
    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let settled = false;
    let forceKillTimeout: NodeJS.Timeout | null = null;

    const appendBounded = (
      current: string,
      value: string,
      onTruncated: () => void,
    ) => {
      const combined = current + value;
      const bytes = Buffer.from(combined, 'utf8');
      if (bytes.length <= maxOutputBytes) return combined;
      onTruncated();
      let start = bytes.length - maxOutputBytes;
      while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) {
        start += 1;
      }
      return bytes.subarray(start).toString('utf8');
    };

    const signalTree = (signal: NodeJS.Signals) => {
      try {
        if (useProcessGroup && child.pid) process.kill(-child.pid, signal);
        else if (child.exitCode == null && child.signalCode == null) {
          child.kill(signal);
        }
      } catch {
        if (child.exitCode == null && child.signalCode == null) {
          child.kill(signal);
        }
      }
    };
    const stop = () => {
      signalTree('SIGTERM');
      forceKillTimeout ||= setTimeout(() => signalTree('SIGKILL'), 5_000);
    };
    const onAbort = () => stop();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          stop();
        }, options.timeoutMs)
      : null;

    child.stdin?.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED') {
        return;
      }
      stderr = appendBounded(
        stderr,
        `\nFailed to write process input: ${error.message}`,
        () => {
          stderrTruncated = true;
        },
      );
      stop();
    });
    if (options.input !== undefined) {
      child.stdin?.end(options.input);
    }

    child.stdout?.on('data', (chunk) => {
      const value = chunk.toString();
      stdout = appendBounded(stdout, value, () => {
        stdoutTruncated = true;
      });
      options.onStdout?.(value);
      if (options.stream) process.stdout.write(value);
    });
    child.stderr?.on('data', (chunk) => {
      const value = chunk.toString();
      stderr = appendBounded(stderr, value, () => {
        stderrTruncated = true;
      });
      options.onStderr?.(value);
      if (options.stream) process.stderr.write(value);
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
      options.signal?.removeEventListener('abort', onAbort);
      reject(error);
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({
        code: code ?? 1,
        durationMs: Date.now() - startedAt,
        signal,
        stderr,
        ...(stderrTruncated ? { stderrTruncated: true } : {}),
        stdout,
        ...(stdoutTruncated ? { stdoutTruncated: true } : {}),
        timedOut,
      });
    });
  });
}
