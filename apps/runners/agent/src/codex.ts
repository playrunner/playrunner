import { createCodexEnvironment } from './codex-auth';
import { runProcess } from './process';
import {
  credentialSafeErrorMessage,
  CREDENTIAL_LEAK_MESSAGE,
  normalizeProhibitedExactValues,
} from './secret-values';

type JsonRecord = Record<string, unknown>;

const CODEX_RUNTIME_FAILURES: Array<{
  message: string;
  pattern: RegExp;
}> = [
  {
    message:
      'Codex could not execute tools because its sandbox failed to initialize (SeccompInstall: Invalid argument).',
    pattern: /SeccompInstall[\s\S]{0,500}Invalid argument/i,
  },
  {
    message:
      'Codex could not execute tools because its sandbox failed to initialize.',
    pattern:
      /sandbox initialization[\s\S]{0,300}(?:fail(?:ed|ure)|invalid argument)/i,
  },
];

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export function codexThreadIdFromEvent(value: unknown): string | undefined {
  const event = record(value);
  for (const candidate of [event.thread_id, event.threadId]) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  if (event.type === 'thread.started') {
    const nestedThread = record(event.thread);
    for (const candidate of [event.id, nestedThread.id]) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
  }
  return undefined;
}

export function createCodexEventParser() {
  let buffer = '';
  let completionSummary: string | undefined;
  let failure: string | undefined;
  let threadId: string | undefined;
  const parseLine = (line: string) => {
    if (!line.trim()) return;
    try {
      const event = record(JSON.parse(line));
      const serializedEvent = JSON.stringify(event);
      for (const runtimeFailure of CODEX_RUNTIME_FAILURES) {
        if (runtimeFailure.pattern.test(serializedEvent)) {
          failure ||= runtimeFailure.message;
          break;
        }
      }
      if (event.type === 'turn.failed') {
        failure ||= 'Codex reported that the agent turn failed.';
      }
      threadId ||= codexThreadIdFromEvent(event);
      const item = record(event.item);
      if (
        event.type === 'item.completed' &&
        item.type === 'agent_message' &&
        typeof item.text === 'string' &&
        item.text.trim()
      ) {
        completionSummary = item.text.trim();
      }
    } catch {
      // The CLI may interleave human-readable diagnostics with JSONL. Those
      // diagnostics are still streamed and retained by runProcess.
    }
  };
  return {
    finish() {
      parseLine(buffer);
      buffer = '';
      return threadId;
    },
    failure() {
      return failure;
    },
    push(chunk: string) {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) parseLine(line);
    },
    summary() {
      return completionSummary;
    },
  };
}

export function createCodexArgs(options: {
  config: Record<string, unknown>;
  prompt: string;
  resumeSessionId?: string;
}): string[] {
  const args = ['exec'];
  const selectedApiKey = String(options.config.apiKeyEnvVar || '').trim();
  const excludedShellVariables = Array.from(
    new Set(
      [
        'CODEX_API_KEY',
        'CODEX_ACCESS_TOKEN',
        'OPENAI_API_KEY',
        'PLAYRUNNER_AGENT_BOOTSTRAP',
        selectedApiKey,
      ].filter(Boolean),
    ),
  );
  args.push(
    '--json',
    '--strict-config',
    '--ignore-user-config',
    '--ignore-rules',
    '--sandbox',
    'workspace-write',
    '--disable',
    'apps',
    '--disable',
    'browser_use',
    '--disable',
    'browser_use_external',
    '--disable',
    'browser_use_full_cdp_access',
    '--disable',
    'computer_use',
    '--disable',
    'hooks',
    '--disable',
    'image_generation',
    '--disable',
    'in_app_browser',
    '--disable',
    'multi_agent',
    '--disable',
    'plugins',
    '--disable',
    'remote_plugin',
    '--disable',
    'recommended_plugins',
    '--disable',
    'skill_mcp_dependency_install',
    '-c',
    'approval_policy="never"',
    '-c',
    'sandbox_workspace_write.network_access=false',
    '-c',
    'sandbox_workspace_write.exclude_slash_tmp=true',
    '-c',
    'sandbox_workspace_write.exclude_tmpdir_env_var=true',
    '-c',
    'web_search="disabled"',
    '-c',
    `shell_environment_policy.exclude=${JSON.stringify(excludedShellVariables)}`,
    '-c',
    'allow_login_shell=false',
  );
  if (options.config.model) {
    args.push('--model', String(options.config.model));
  }
  if (options.config.reasoningEffort) {
    args.push(
      '-c',
      `model_reasoning_effort=${JSON.stringify(String(options.config.reasoningEffort))}`,
    );
  }
  if (options.resumeSessionId) {
    args.push('resume', options.resumeSessionId);
  }
  // Codex accepts `-` as a prompt read from stdin. Keeping user and validator
  // feedback out of argv avoids Linux's per-argument size limit and keeps the
  // prompt out of process listings.
  args.push('-');
  return args;
}

export async function runCodex(options: {
  config: Record<string, unknown>;
  cwd: string;
  gid?: number;
  environment?: NodeJS.ProcessEnv;
  prompt: string;
  prohibitedExactValues?: readonly string[];
  resumeSessionId?: string;
  timeoutMs: number;
  uid?: number;
}): Promise<{ completionSummary?: string; sessionId?: string }> {
  const args = createCodexArgs(options);

  const parser = createCodexEventParser();
  const environment = createCodexEnvironment(
    options.config,
    options.environment || process.env,
  );
  if (process.env.PLAYRUNNER_AGENT_HOME) {
    environment.HOME = process.env.PLAYRUNNER_AGENT_HOME;
  }
  const prohibitedExactValues = normalizeProhibitedExactValues([
    environment.CODEX_API_KEY,
    ...(options.prohibitedExactValues || []),
  ]);
  const result = await runProcess('codex', args, {
    cwd: options.cwd,
    env: environment,
    gid: options.gid,
    input: options.prompt,
    maxOutputBytes: 2_000_000,
    onStdout: (value) => parser.push(value),
    timeoutMs: options.timeoutMs,
    uid: options.uid,
  });
  const parsedSessionId = parser.finish();
  const parserFailure = parser.failure();
  if (parserFailure) {
    throw new Error(parserFailure);
  }
  if (result.code !== 0 || result.timedOut) {
    const rawDetail = result.stderr || result.stdout;
    const safeDetail = rawDetail
      ? credentialSafeErrorMessage(rawDetail, prohibitedExactValues)
      : '';
    const detail =
      safeDetail === CREDENTIAL_LEAK_MESSAGE
        ? safeDetail
        : safeDetail.slice(-4_000).trim();
    throw new Error(
      result.timedOut
        ? `Codex exceeded the remaining AI Container duration.${detail ? ` ${detail}` : ''}`
        : `Codex CLI exited with code ${result.code}.${detail ? ` ${detail}` : ''}`,
    );
  }
  const rawCompletionSummary = parser.summary();
  const completionSummary = rawCompletionSummary
    ? credentialSafeErrorMessage(rawCompletionSummary, prohibitedExactValues)
        .slice(0, 1_000)
        .trim()
    : undefined;
  return {
    ...(completionSummary ? { completionSummary } : {}),
    sessionId: parsedSessionId || options.resumeSessionId,
  };
}
