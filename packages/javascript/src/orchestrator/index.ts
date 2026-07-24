import { spawn } from 'node:child_process';
import type {
  NodeExecutionContext,
  NodeExecutionResult,
  OrchestratorIntegrationContribution,
  OrchestratorLogLevel,
} from '@playrunner/integration-sdk/orchestrator';

const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 50;
const MAX_TIMEOUT_MS = 60_000;
const MAX_CODE_BYTES = 100 * 1024;
const MAX_RESULT_BYTES = 1024 * 1024;
const MAX_STDERR_BYTES = 8 * 1024;

const SANDBOX_BOOTSTRAP = String.raw`
import vm from 'node:vm';

let requestSource = '';
for await (const chunk of process.stdin) {
  requestSource += chunk;
}

const request = JSON.parse(requestSource);
const context = vm.createContext(Object.create(null), {
  codeGeneration: { strings: false, wasm: false },
  name: 'playrunner-javascript-node',
});
const inputSource = JSON.stringify(request.input);
const source = [
  "(async () => {",
  "  'use strict';",
  "  const deepFreeze = (value, seen = new WeakSet()) => {",
  "    if (",
  "      value === null ||",
  "      (typeof value !== 'object' && typeof value !== 'function') ||",
  "      seen.has(value)",
  "    ) return value;",
  "    seen.add(value);",
  "    for (const key of Reflect.ownKeys(value)) {",
  "      deepFreeze(value[key], seen);",
  "    }",
  "    return Object.freeze(value);",
  "  };",
  "  const stringifyLogValue = (value) => {",
  "    if (typeof value === 'string') return value;",
  "    try { return JSON.stringify(value); } catch { return String(value); }",
  "  };",
  "  const logs = [];",
  "  const appendLog = (level, values) => {",
  "    logs.push({",
  "      level,",
  "      message: values.map(stringifyLogValue).join(' '),",
  "    });",
  "  };",
  "  const console = Object.freeze({",
  "    debug: (...values) => appendLog('debug', values),",
  "    error: (...values) => appendLog('error', values),",
  "    info: (...values) => appendLog('info', values),",
  "    log: (...values) => appendLog('info', values),",
  "    warn: (...values) => appendLog('warn', values),",
  "  });",
  "  const input = deepFreeze(JSON.parse(" +
    JSON.stringify(inputSource) +
    "));",
  "  const env = input.env;",
  "  const workflow = input.workflow;",
  "  const nodes = input.nodes;",
  "  const config = input.config;",
  "  try {",
  "    const output = await (async () => {",
  request.code,
  "    })();",
  "    return JSON.stringify({ logs, ok: true, output });",
  "  } catch (error) {",
  "    return JSON.stringify({",
  "      error: error instanceof Error ? error.message : String(error),",
  "      logs,",
  "      ok: false,",
  "    });",
  "  }",
  "})()",
].join('\n');

try {
  const script = new vm.Script(source, {
    filename: 'playrunner-javascript-node.js',
  });
  const result = await script.runInContext(context, {
    timeout: request.timeoutMs,
  });
  process.stdout.write(result);
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      logs: [],
      ok: false,
    }),
  );
}
`;

type SandboxLog = {
  level: OrchestratorLogLevel;
  message: string;
};

type SandboxResponse = {
  error?: string;
  logs?: SandboxLog[];
  ok: boolean;
  output?: unknown;
};

class JavascriptExecutionError extends Error {}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function executionTimeout(value: unknown): number {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_TIMEOUT_MS;
  }

  const timeout = typeof value === 'number' ? value : Number(value);
  if (
    !Number.isSafeInteger(timeout) ||
    timeout < MIN_TIMEOUT_MS ||
    timeout > MAX_TIMEOUT_MS
  ) {
    throw new JavascriptExecutionError(
      `JavaScript timeout must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} milliseconds.`,
    );
  }
  return timeout;
}

function isSandboxResponse(value: unknown): value is SandboxResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<SandboxResponse>;
  return (
    typeof candidate.ok === 'boolean' &&
    (candidate.error === undefined || typeof candidate.error === 'string') &&
    (candidate.logs === undefined ||
      (Array.isArray(candidate.logs) &&
        candidate.logs.every(
          (log) =>
            typeof log === 'object' &&
            log !== null &&
            typeof log.message === 'string' &&
            ['info', 'warn', 'error', 'build', 'debug'].includes(log.level),
        )))
  );
}

function runSandbox(
  code: string,
  input: Record<string, unknown>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<SandboxResponse> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--permission',
        '--disable-proto=throw',
        '--max-old-space-size=64',
        '--input-type=module',
        '--eval',
        SANDBOX_BOOTSTRAP,
      ],
      {
        env: {},
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';
    let settled = false;
    let terminationReason: 'aborted' | 'output' | 'timeout' | undefined;

    const terminate = (reason: typeof terminationReason) => {
      if (!terminationReason) terminationReason = reason;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(() => terminate('timeout'), timeoutMs);
    const abort = () => terminate('aborted');
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > MAX_RESULT_BYTES) {
        terminate('output');
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      const remainingBytes = MAX_STDERR_BYTES - Buffer.byteLength(stderr);
      if (remainingBytes <= 0) return;
      stderr += Buffer.from(chunk).subarray(0, remainingBytes).toString('utf8');
    });

    const finish = (callback: () => void, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else callback();
    };

    child.on('error', (error) => {
      finish(() => undefined, error);
    });

    child.on('close', (exitCode) => {
      finish(() => {
        if (terminationReason === 'aborted') {
          reject(new JavascriptExecutionError('Execution was cancelled.'));
          return;
        }
        if (terminationReason === 'timeout') {
          reject(
            new JavascriptExecutionError(
              `Execution exceeded the ${timeoutMs}ms timeout.`,
            ),
          );
          return;
        }
        if (terminationReason === 'output') {
          reject(
            new JavascriptExecutionError(
              `Execution output exceeded ${MAX_RESULT_BYTES} bytes.`,
            ),
          );
          return;
        }
        if (exitCode !== 0) {
          reject(
            new JavascriptExecutionError(
              stderr.trim()
                ? `Sandbox exited unexpectedly: ${stderr.trim()}`
                : `Sandbox exited unexpectedly with code ${String(exitCode)}.`,
            ),
          );
          return;
        }

        let response: unknown;
        try {
          response = JSON.parse(stdout);
        } catch {
          reject(
            new JavascriptExecutionError(
              'Sandbox returned an invalid response.',
            ),
          );
          return;
        }
        if (!isSandboxResponse(response)) {
          reject(
            new JavascriptExecutionError(
              'Sandbox returned a malformed response.',
            ),
          );
          return;
        }
        resolve(response);
      });
    });

    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify({ code, input, timeoutMs }));
  });
}

async function executeJavascript(
  context: NodeExecutionContext,
): Promise<NodeExecutionResult> {
  try {
    const code = optionalString(context.node.config.code);
    if (!code) {
      throw new JavascriptExecutionError('JavaScript code is required.');
    }
    if (Buffer.byteLength(code) > MAX_CODE_BYTES) {
      throw new JavascriptExecutionError(
        `JavaScript code must not exceed ${MAX_CODE_BYTES} bytes.`,
      );
    }

    const timeoutMs = executionTimeout(context.node.config.timeoutMs);
    await context.log('Running JavaScript in an isolated process...', 'info');
    const response = await runSandbox(
      code,
      {
        config: Object.fromEntries(
          Object.entries(context.node.config).filter(([key]) => key !== 'code'),
        ),
        env: context.env,
        nodes: context.nodeOutputs ?? {},
        workflow: context.workflow,
      },
      timeoutMs,
      context.signal,
    );

    for (const log of response.logs ?? []) {
      await context.log(log.message, log.level);
    }
    if (!response.ok) {
      throw new JavascriptExecutionError(
        response.error || 'JavaScript execution failed.',
      );
    }

    await context.log('JavaScript completed successfully.', 'info');
    return {
      outcome: 'success',
      ...(Object.hasOwn(response, 'output') ? { output: response.output } : {}),
    };
  } catch (error) {
    const message =
      error instanceof JavascriptExecutionError
        ? error.message
        : context.signal.aborted
          ? 'Execution was cancelled.'
          : 'JavaScript execution failed.';
    throw new Error(`JavaScript action failed: ${message}`);
  }
}

export const javascriptOrchestratorContribution = {
  contractVersion: 1,
  id: 'code',
  executors: [
    {
      nodeType: 'code',
      default: true,
      execute: executeJavascript,
    },
  ],
} satisfies OrchestratorIntegrationContribution;

export default javascriptOrchestratorContribution;
