const VERSION = '0.1.3';
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

type JsonRecord = Record<string, unknown>;

export type CliDependencies = {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  signal?: AbortSignal;
  stderr?: (line: string) => void;
  stdout?: (line: string) => void;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
};

type Options = {
  apiKey: string;
  json: boolean;
  timeoutMs: number;
  url: string;
  wait: boolean;
  workflowId: string;
};

function usage() {
  return `Usage: playrunner <workflow-id> [options]

Options:
  --url <url>          Playrunner server URL (or PLAYRUNNER_URL)
  --no-wait            Return after the workflow starts
  --timeout <duration> Wait timeout, for example 30s, 10m, or 1h
  --json               Emit newline-delimited JSON
  --version            Print the CLI version
  --help               Show this help

Environment:
  PLAYRUNNER_API_KEY    Machine API token (required)
  PLAYRUNNER_URL        Playrunner server URL`;
}

function parseDuration(value: string) {
  const match = value.trim().match(/^(\d+)(ms|s|m|h)$/);
  if (!match)
    throw new Error('Timeout must use ms, s, m, or h (for example 10m).');
  const amount = Number(match[1]);
  const multiplier = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[
    match[2] as 'ms' | 's' | 'm' | 'h'
  ];
  const duration = amount * multiplier;
  if (!Number.isSafeInteger(duration) || duration <= 0) {
    throw new Error('Timeout must be greater than zero.');
  }
  return duration;
}

function parseOptions(
  args: string[],
  env: NodeJS.ProcessEnv,
): Options | 'help' | 'version' {
  if (args.includes('--help') || args.includes('-h')) return 'help';
  if (args.includes('--version') || args.includes('-v')) return 'version';

  let url = env.PLAYRUNNER_URL?.trim() ?? '';
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let wait = true;
  let json = false;
  let workflowId = '';

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--no-wait') wait = false;
    else if (arg === '--json') json = true;
    else if (arg === '--url' || arg === '--timeout') {
      const value = args[index + 1];
      if (!value) throw new Error(`${arg} requires a value.`);
      index += 1;
      if (arg === '--url') url = value;
      else timeoutMs = parseDuration(value);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!workflowId) workflowId = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }

  const apiKey = env.PLAYRUNNER_API_KEY?.trim() ?? '';
  if (!workflowId) throw new Error('A workflow ID is required.');
  if (!url) throw new Error('PLAYRUNNER_URL or --url is required.');
  if (!apiKey) throw new Error('PLAYRUNNER_API_KEY is required.');

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('The Playrunner URL is invalid.');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('The Playrunner URL must use HTTP or HTTPS.');
  }
  parsedUrl.username = '';
  parsedUrl.password = '';
  parsedUrl.search = '';
  parsedUrl.hash = '';

  return {
    apiKey,
    json,
    timeoutMs,
    url: parsedUrl.toString().replace(/\/$/, ''),
    wait,
    workflowId,
  };
}

async function responseJson(response: Response): Promise<JsonRecord> {
  return ((await response.json().catch(() => ({}))) ?? {}) as JsonRecord;
}

function messageFrom(payload: JsonRecord, fallback: string) {
  return typeof payload.error === 'string' ? payload.error : fallback;
}

function redactApiKey(value: string, apiKey: string) {
  return apiKey ? value.split(apiKey).join('[redacted]') : value;
}

async function defaultWait(milliseconds: number, signal: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

export async function runCli(
  args: string[],
  dependencies: CliDependencies = {},
): Promise<number> {
  const env = dependencies.env ?? process.env;
  const output = dependencies.stdout ?? ((line) => console.log(line));
  const outputError = dependencies.stderr ?? ((line) => console.error(line));
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const now = dependencies.now ?? Date.now;
  const waitFor = dependencies.wait ?? defaultWait;

  let options: Options | 'help' | 'version';
  try {
    options = parseOptions(args, env);
  } catch (error) {
    outputError((error as Error).message);
    outputError('Run playrunner --help for usage.');
    return 2;
  }
  if (options === 'help') {
    output(usage());
    return 0;
  }
  if (options === 'version') {
    output(VERSION);
    return 0;
  }

  const controller = new AbortController();
  if (dependencies.signal) {
    if (dependencies.signal.aborted)
      controller.abort(dependencies.signal.reason);
    else
      dependencies.signal.addEventListener(
        'abort',
        () => controller.abort(dependencies.signal?.reason),
        { once: true },
      );
  }
  const basePath = `${options.url}/api/v1/workflows/${encodeURIComponent(options.workflowId)}/executions`;
  const headers = {
    Authorization: `Bearer ${options.apiKey}`,
    'Content-Type': 'application/json',
  };
  const emit = (kind: string, payload: JsonRecord) => {
    const safePayload = Object.fromEntries(
      Object.entries(payload).map(([key, value]) => [
        key,
        typeof value === 'string' ? redactApiKey(value, options.apiKey) : value,
      ]),
    );
    if (options.json) output(JSON.stringify({ type: kind, ...safePayload }));
    else if (kind === 'event' && typeof safePayload.message === 'string')
      output(safePayload.message);
    else if (kind !== 'event')
      output(
        typeof safePayload.message === 'string'
          ? safePayload.message
          : JSON.stringify(safePayload),
      );
  };
  const emitError = (message: string) => {
    const safeMessage = redactApiKey(message, options.apiKey);
    outputError(
      options.json
        ? JSON.stringify({ type: 'error', message: safeMessage })
        : safeMessage,
    );
  };

  try {
    const response = await fetchImpl(basePath, {
      method: 'POST',
      headers,
      body: '{}',
      signal: controller.signal,
    });
    const started = await responseJson(response);
    if (!response.ok) {
      emitError(
        messageFrom(started, `Request failed with status ${response.status}.`),
      );
      return 2;
    }
    const executionId =
      typeof started.executionId === 'string' ? started.executionId : '';
    if (!executionId) {
      emitError('Playrunner returned an invalid start response.');
      return 2;
    }
    emit('started', {
      executionId,
      message: `Workflow started: ${executionId}`,
      workflowId: options.workflowId,
    });
    if (!options.wait) return 0;

    const deadline = now() + options.timeoutMs;
    let cursor = '0';
    while (now() < deadline) {
      const eventsResponse = await fetchImpl(
        `${basePath}/${encodeURIComponent(executionId)}/events?after=${encodeURIComponent(cursor)}`,
        { headers, signal: controller.signal },
      );
      const eventsPayload = await responseJson(eventsResponse);
      if (!eventsResponse.ok) {
        emitError(
          messageFrom(eventsPayload, 'Failed to read workflow events.'),
        );
        return 2;
      }
      const events = Array.isArray(eventsPayload.events)
        ? (eventsPayload.events as JsonRecord[])
        : [];
      for (const event of events) {
        if (typeof event.sequence === 'string') cursor = event.sequence;
        emit('event', event);
      }

      const statusResponse = await fetchImpl(
        `${basePath}/${encodeURIComponent(executionId)}`,
        { headers, signal: controller.signal },
      );
      const statusPayload = await responseJson(statusResponse);
      if (!statusResponse.ok) {
        emitError(
          messageFrom(statusPayload, 'Failed to read workflow status.'),
        );
        return 2;
      }
      const status =
        typeof statusPayload.status === 'string'
          ? statusPayload.status
          : 'unknown';
      if (TERMINAL_STATUSES.has(status)) {
        emit('completed', {
          executionId,
          message: `Workflow ${status}: ${executionId}`,
          status,
          workflowId: options.workflowId,
        });
        return status === 'completed' ? 0 : 1;
      }
      await waitFor(DEFAULT_POLL_INTERVAL_MS, controller.signal);
    }
    emitError(`Workflow timed out after ${options.timeoutMs}ms.`);
    return 124;
  } catch (error) {
    if (controller.signal.aborted) return 130;
    emitError(`Playrunner request failed: ${(error as Error).message}`);
    return 2;
  }
}
