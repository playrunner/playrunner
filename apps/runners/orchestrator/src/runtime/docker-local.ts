import { spawn, type ChildProcess } from 'child_process';
import type { PreparedIsolatedRunner } from './contracts';

const DEFAULT_DOCKER_STOP_TIMEOUT_MS = 15_000;
const DEFAULT_STDIN_TIMEOUT_MS = 30_000;
const RESULT_AFTER_EXIT_GRACE_MS = 65_000;
const CANCEL_PUBLISH_GRACE_MS = 2_000;
const MAX_BUFFERED_LOG_CHARACTERS = 64 * 1024;
const LOCAL_DOCKER_LOG_PUBLISH_TIMEOUT_MS = 2_000;
const LOCAL_DOCKER_LOG_DRAIN_TIMEOUT_MS = 5_000;
export const LOCAL_DOCKER_LOG_LIMITS = Object.freeze({
  bytes: 1024 * 1024,
  lines: 2_000,
  pendingBytes: 128 * 1024,
  pendingLines: 64,
});

type LocalRunnerControl<TResult> = {
  cleanup: () => Promise<void>;
  publishCancel: () => Promise<void>;
  startWithRetry: () => Promise<void>;
  waitForCompletion: () => Promise<TResult>;
  waitUntilReady: () => Promise<void>;
};

type LocalDockerLogLevel = 'debug' | 'error' | 'info' | 'warn';

export type LocalDockerRunnerOptions<TResult> = {
  args: string[];
  containerName: string;
  control: LocalRunnerControl<TResult>;
  environment?: NodeJS.ProcessEnv;
  executionTimeoutMs?: number;
  input?: string;
  label: string;
  nodeId: string;
  publishLog: (message: string, level?: LocalDockerLogLevel) => Promise<void>;
  registerActiveProcess: (nodeId: string, process: ChildProcess) => void;
  shouldPublishLine?: (line: string) => boolean;
  spawnProcess?: typeof spawn;
  stderrLevel?: LocalDockerLogLevel;
  stopContainer?: typeof stopLocalContainer;
};

export function createLocalContainerName(
  prefix: string,
  executionId: string,
  nodeId: string,
): string {
  return `${prefix}-${executionId}-${nodeId}`
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '-')
    .slice(0, 120);
}

export function resolveDockerPubSubEmulatorHost(
  value: string | undefined,
): string | undefined {
  const host = value?.trim();
  if (!host) return undefined;
  return host.replace(
    /^(https?:\/\/)?(?:127\.0\.0\.1|localhost|\[::1\])(?=[:/]|$)/i,
    (_, scheme: string | undefined) => `${scheme || ''}host.docker.internal`,
  );
}

export async function stopLocalContainer(
  name: string,
  timeoutMs = DEFAULT_DOCKER_STOP_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    const stopProcess = spawn('docker', ['stop', '--time', '5', name], {
      stdio: 'ignore',
    });
    let settled = false;
    const finish = (stopped: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(stopped);
    };
    const timeout = setTimeout(
      () => {
        stopProcess.kill('SIGKILL');
        finish(false);
      },
      Math.max(1, timeoutMs),
    );
    timeout.unref();
    stopProcess.once('error', () => finish(false));
    stopProcess.once('close', (code) => finish(code === 0));
  });
}

function createLineEmitter(emit: (line: string) => void): {
  flush: () => void;
  push: (chunk: Buffer | string) => void;
} {
  let buffered = '';

  const publish = (line: string) => {
    const trimmed = line.trim();
    if (trimmed) emit(trimmed);
  };

  return {
    flush: () => {
      publish(buffered);
      buffered = '';
    },
    push: (chunk) => {
      buffered += chunk.toString();
      if (buffered.length > MAX_BUFFERED_LOG_CHARACTERS) {
        publish(
          `[output truncated] ${buffered.slice(-MAX_BUFFERED_LOG_CHARACTERS)}`,
        );
        buffered = '';
        return;
      }
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() || '';
      for (const line of lines) publish(line);
    },
  };
}

export function createBoundedLocalDockerLogPublisher(options: {
  publishLog: (message: string, level?: LocalDockerLogLevel) => Promise<void>;
  shouldPublishLine?: (line: string) => boolean;
}): {
  drain: () => Promise<void>;
  publish: (line: string, level: LocalDockerLogLevel) => void;
} {
  let acceptedBytes = 0;
  let acceptedLines = 0;
  let pendingBytes = 0;
  let pendingLines = 0;
  let publishChain: Promise<void> = Promise.resolve();
  let stopped = false;
  let truncationQueued = false;

  const publishWithTimeout = async (
    message: string,
    level: LocalDockerLogLevel,
  ) => {
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        options.publishLog(message, level),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Local Docker log publication timed out.')),
            LOCAL_DOCKER_LOG_PUBLISH_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };

  const enqueue = (
    message: string,
    level: LocalDockerLogLevel,
    messageBytes: number,
  ) => {
    pendingLines += 1;
    pendingBytes += messageBytes;
    const operation = publishChain.then(async () => {
      if (stopped) return;
      try {
        await publishWithTimeout(message, level);
      } catch (error) {
        console.warn(
          `[Local] Failed to publish Docker output: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
    publishChain = operation.finally(() => {
      pendingLines -= 1;
      pendingBytes -= messageBytes;
    });
  };

  const queueTruncationNotice = () => {
    if (truncationQueued) return;
    truncationQueued = true;
    const notice =
      '[Local Docker] Output truncated after reaching the per-run log publication limit.';
    enqueue(notice, 'warn', Buffer.byteLength(notice, 'utf8'));
  };

  return {
    drain: async () => {
      const target = publishChain;
      let timeout: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          target,
          new Promise<void>((resolve) => {
            timeout = setTimeout(resolve, LOCAL_DOCKER_LOG_DRAIN_TIMEOUT_MS);
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
        if (pendingLines > 0) stopped = true;
      }
    },
    publish: (line, level) => {
      if (stopped || truncationQueued) return;
      if (options.shouldPublishLine && !options.shouldPublishLine(line)) return;
      const message = `[Local Docker] ${line}`;
      const messageBytes = Buffer.byteLength(message, 'utf8');
      if (
        acceptedLines >= LOCAL_DOCKER_LOG_LIMITS.lines ||
        acceptedBytes + messageBytes > LOCAL_DOCKER_LOG_LIMITS.bytes ||
        pendingLines >= LOCAL_DOCKER_LOG_LIMITS.pendingLines ||
        pendingBytes + messageBytes > LOCAL_DOCKER_LOG_LIMITS.pendingBytes
      ) {
        queueTruncationNotice();
        return;
      }
      acceptedLines += 1;
      acceptedBytes += messageBytes;
      enqueue(message, level, messageBytes);
    },
  };
}

async function writeDockerInput(
  child: ChildProcess,
  input: string,
  timeoutMs = DEFAULT_STDIN_TIMEOUT_MS,
): Promise<void> {
  if (!child.stdin) {
    throw new Error('Local Docker process has no stdin stream.');
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.stdin?.off('error', onError);
      if (error) reject(error);
      else resolve();
    };
    const onError = (error: Error) => finish(error);
    const timeout = setTimeout(
      () => finish(new Error('Timed out writing the local runner payload.')),
      Math.max(1, timeoutMs),
    );
    timeout.unref();
    child.stdin.once('error', onError);
    child.stdin.end(input, () => finish());
  });
}

export async function prepareLocalDockerRunner<TResult>(
  options: LocalDockerRunnerOptions<TResult>,
): Promise<PreparedIsolatedRunner<TResult>> {
  const child = (options.spawnProcess || spawn)('docker', options.args, {
    env: options.environment || process.env,
    stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  });
  options.registerActiveProcess(options.nodeId, child);

  const logPublisher = createBoundedLocalDockerLogPublisher({
    publishLog: options.publishLog,
    shouldPublishLine: options.shouldPublishLine,
  });
  const stdout = createLineEmitter((line) =>
    logPublisher.publish(line, 'info'),
  );
  const stderr = createLineEmitter((line) =>
    logPublisher.publish(line, options.stderrLevel || 'error'),
  );
  child.stdout?.on('data', stdout.push);
  child.stderr?.on('data', stderr.push);

  let completed = false;
  const completion = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      stdout.flush();
      stderr.flush();
      void logPublisher.drain().then(() => {
        if (code === 0) resolve();
        else if (code === null) {
          reject(new Error(`${options.label} stopped by user.`));
        } else {
          reject(new Error(`${options.label} exited with code ${code}.`));
        }
      });
    });
  });
  completion.then(
    () => {
      completed = true;
    },
    () => {
      completed = true;
    },
  );
  // Preparation can fail before a caller reaches waitForCompletion(). Preserve
  // the rejection for normal waiters without creating an unhandled rejection.
  void completion.catch(() => {});

  let cancelRequested = false;
  let rejectCancellation!: (error: Error) => void;
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  // A caller may cancel before it begins awaiting a lifecycle method.
  // Retain the rejection for those races without creating an unhandled one.
  void cancellation.catch(() => {});
  let cancelPublished = false;
  let stopRequested = false;
  const markCancelled = () => {
    if (cancelRequested) return;
    cancelRequested = true;
    rejectCancellation(new Error(`${options.label} was cancelled.`));
  };
  const publishCancel = async () => {
    if (cancelPublished) return;
    cancelPublished = true;
    await options.control.publishCancel().catch((error) => {
      console.warn(
        `[Local] Failed to signal cancellation for ${options.label}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  };
  const stop = async () => {
    if (completed || stopRequested) return;
    stopRequested = true;
    if (
      !(await (options.stopContainer || stopLocalContainer)(
        options.containerName,
      ))
    ) {
      child.kill('SIGTERM');
    }
  };
  let executionTimeout: NodeJS.Timeout | undefined;
  let rejectExecutionTimeout!: (error: Error) => void;
  const executionDeadline = new Promise<never>((_resolve, reject) => {
    rejectExecutionTimeout = reject;
  });
  void executionDeadline.catch(() => {});
  const startExecutionDeadline = () => {
    if (!options.executionTimeoutMs || executionTimeout) return;
    executionTimeout = setTimeout(
      () => {
        rejectExecutionTimeout(
          new Error(`${options.label} exceeded its execution time limit.`),
        );
        void Promise.allSettled([publishCancel(), stop()]);
      },
      Math.max(1, options.executionTimeoutMs),
    );
    executionTimeout.unref();
  };
  const clearExecutionDeadline = () => {
    if (executionTimeout) clearTimeout(executionTimeout);
    executionTimeout = undefined;
  };
  const publishCancelBriefly = async () => {
    await Promise.race([
      publishCancel(),
      new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, CANCEL_PUBLISH_GRACE_MS);
        timeout.unref();
      }),
    ]);
  };

  if (options.input !== undefined) {
    try {
      await writeDockerInput(child, options.input);
    } catch (error) {
      await stop();
      await options.control.cleanup();
      throw error;
    }
  }

  return {
    cancel: async () => {
      markCancelled();
      await Promise.allSettled([stop(), publishCancelBriefly()]);
    },
    cleanup: async () => {
      clearExecutionDeadline();
      try {
        if (!completed) {
          await Promise.allSettled([stop(), publishCancelBriefly()]);
        }
      } finally {
        await options.control.cleanup();
      }
    },
    start: async () => {
      if (cancelRequested) {
        throw new Error(`${options.label} start was cancelled.`);
      }
      await Promise.race([
        options.control.startWithRetry(),
        completion.then(() => {
          throw new Error(
            `${options.label} exited before acknowledging start.`,
          );
        }),
        cancellation,
        executionDeadline,
      ]);
      startExecutionDeadline();
    },
    waitForCompletion: async () => {
      const result = options.control.waitForCompletion();
      let exitGraceTimeout: NodeJS.Timeout | undefined;
      let waitFinished = false;
      const waitForExitGrace = () =>
        new Promise<void>((resolve) => {
          if (waitFinished) {
            resolve();
            return;
          }
          exitGraceTimeout = setTimeout(resolve, RESULT_AFTER_EXIT_GRACE_MS);
        });
      const exitedWithoutResult = completion.then(
        async () => {
          await waitForExitGrace();
          throw new Error(
            `${options.label} exited without reporting a result.`,
          );
        },
        async (error) => {
          await waitForExitGrace();
          throw error;
        },
      );
      try {
        return await Promise.race([
          result,
          exitedWithoutResult,
          cancellation,
          executionDeadline,
        ]);
      } finally {
        waitFinished = true;
        if (exitGraceTimeout) clearTimeout(exitGraceTimeout);
        clearExecutionDeadline();
      }
    },
    waitUntilReady: async () => {
      if (cancelRequested) {
        throw new Error(`${options.label} preparation was cancelled.`);
      }
      await Promise.race([
        options.control.waitUntilReady(),
        completion.then(() => {
          throw new Error(`${options.label} exited before reporting ready.`);
        }),
        cancellation,
      ]);
    },
  };
}
