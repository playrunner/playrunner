import { runWorkflowCreateCli } from './workflow-create.js';
import { runCompanionCommand } from './companion.js';

const VERSION = '0.2.5';
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const EVENT_PAGE_SIZE = 100;
const MAX_EVENT_PAGES_PER_POLL = 10;
const MAX_RATE_LIMIT_WAIT_MS = 60_000;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

type JsonRecord = Record<string, unknown>;

export type CliDependencies = {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  readFile?: (path: string, encoding: 'utf8') => Promise<string>;
  signal?: AbortSignal;
  stderr?: (line: string) => void;
  stdout?: (line: string) => void;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
};

type Options = {
  acceptanceCriteria: string[];
  apiKey: string;
  changeContext?: {
    baseRef: string;
    baseSha: string;
    eventType: 'manual' | 'pull_request' | 'push';
    headRef: string;
    headSha: string;
    pullRequestNumber?: number;
    repository: { name: string; owner: string };
  };
  json: boolean;
  inputs: Record<string, string>;
  timeoutMs: number;
  url: string;
  wait: boolean;
  workflowId: string;
};

function usage() {
  return `Usage: playrunner <workflow-id> [options]
       playrunner workflow create --file <path> [options]

Commands:
  workflow create      Create or update a workflow from a JSON definition
  login                Pair this device with Playrunner Cloud
  auth connect         Receive Authentication Profile capture requests
  auth install         Advanced: install the persistent companion service
  auth status          Inspect this device's pairing status
  auth disconnect      Revoke and remove this device's pairing

Options:
  --url <url>          Playrunner server URL (or PLAYRUNNER_URL)
  --repository <repo>  GitHub repository in owner/name form
  --base-sha <sha>     Complete base commit SHA
  --head-sha <sha>     Complete developer commit SHA
  --base-ref <ref>     Base branch name
  --head-ref <ref>     Developer branch name
  --event-type <type>  push, pull_request, or manual
  --pull-request <n>   Source pull request number, when applicable
  --input <name=value> Workflow input; repeat for multiple values
  --acceptance-criteria <text> Acceptance criterion; repeat as needed
  --no-wait            Return after the workflow starts
  --timeout <duration> Wait timeout, for example 30s, 10m, or 1h
  --json               Emit newline-delimited JSON
  --version            Print the CLI version
  --help               Show this help

Environment:
  PLAYRUNNER_API_KEY    Machine API token (required)
  PLAYRUNNER_URL        Playrunner server URL
  PLAYRUNNER_REPOSITORY Repository (or GITHUB_REPOSITORY)
  PLAYRUNNER_BASE_SHA   Base commit SHA
  PLAYRUNNER_HEAD_SHA   Head commit SHA (or GITHUB_SHA for push events)
  PLAYRUNNER_BASE_REF   Base branch (or GITHUB_BASE_REF)
  PLAYRUNNER_HEAD_REF   Head branch (or GITHUB_HEAD_REF/GITHUB_REF_NAME)`;
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
  let repository =
    env.PLAYRUNNER_REPOSITORY?.trim() || env.GITHUB_REPOSITORY?.trim() || '';
  let baseSha = env.PLAYRUNNER_BASE_SHA?.trim() || '';
  let headSha =
    env.PLAYRUNNER_HEAD_SHA?.trim() ||
    (env.GITHUB_EVENT_NAME === 'push' ? env.GITHUB_SHA?.trim() : '') ||
    '';
  let baseRef =
    env.PLAYRUNNER_BASE_REF?.trim() || env.GITHUB_BASE_REF?.trim() || '';
  let headRef =
    env.PLAYRUNNER_HEAD_REF?.trim() ||
    env.GITHUB_HEAD_REF?.trim() ||
    env.GITHUB_REF_NAME?.trim() ||
    '';
  let eventType =
    env.PLAYRUNNER_EVENT_TYPE?.trim() ||
    (env.GITHUB_EVENT_NAME === 'pull_request'
      ? 'pull_request'
      : env.GITHUB_EVENT_NAME === 'push'
        ? 'push'
        : 'manual');
  let pullRequest = env.PLAYRUNNER_PULL_REQUEST_NUMBER?.trim() || '';
  const inputs: Record<string, string> = {};
  const acceptanceCriteria: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--no-wait') wait = false;
    else if (arg === '--json') json = true;
    else if (
      [
        '--base-ref',
        '--base-sha',
        '--event-type',
        '--head-ref',
        '--head-sha',
        '--pull-request',
        '--repository',
        '--timeout',
        '--url',
        '--input',
        '--acceptance-criteria',
      ].includes(arg)
    ) {
      const value = args[index + 1];
      if (!value) throw new Error(`${arg} requires a value.`);
      index += 1;
      if (arg === '--url') url = value;
      else if (arg === '--acceptance-criteria') acceptanceCriteria.push(value);
      else if (arg === '--input') {
        const separator = value.indexOf('=');
        const name = separator > 0 ? value.slice(0, separator) : '';
        const inputValue = separator > 0 ? value.slice(separator + 1) : '';
        if (
          !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name) ||
          inputValue.length > 4_096
        ) {
          throw new Error(
            '--input must use name=value with a safe name and at most 4096 characters.',
          );
        }
        inputs[name] = inputValue;
      } else if (arg === '--timeout') timeoutMs = parseDuration(value);
      else if (arg === '--repository') repository = value;
      else if (arg === '--base-sha') baseSha = value;
      else if (arg === '--head-sha') headSha = value;
      else if (arg === '--base-ref') baseRef = value;
      else if (arg === '--head-ref') headRef = value;
      else if (arg === '--event-type') eventType = value;
      else pullRequest = value;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!workflowId) workflowId = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }

  const apiKey = env.PLAYRUNNER_API_KEY?.trim() ?? '';
  if (!workflowId) throw new Error('A workflow ID is required.');
  if (!url) throw new Error('PLAYRUNNER_URL or --url is required.');
  if (!apiKey) throw new Error('PLAYRUNNER_API_KEY is required.');
  if (
    acceptanceCriteria.length > 20 ||
    acceptanceCriteria.some(
      (item) => item.length > 4_096 || item.includes('\0'),
    )
  ) {
    throw new Error(
      '--acceptance-criteria may be repeated at most 20 times and each value must be at most 4096 characters.',
    );
  }

  const hasChangeContext = Boolean(
    repository ||
    baseSha ||
    headSha ||
    baseRef ||
    headRef ||
    pullRequest ||
    eventType !== 'manual',
  );
  if (!hasChangeContext) {
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
      acceptanceCriteria,
      apiKey,
      json,
      inputs,
      timeoutMs,
      url: parsedUrl.toString().replace(/\/$/, ''),
      wait,
      workflowId,
    };
  }

  const repositoryMatch =
    /^([A-Za-z0-9][A-Za-z0-9_.-]{0,99})\/([A-Za-z0-9][A-Za-z0-9_.-]{0,99})$/.exec(
      repository,
    );
  if (
    !repositoryMatch ||
    [repositoryMatch?.[1], repositoryMatch?.[2]].some(
      (part) => part === '.' || part === '..' || part?.endsWith('-'),
    )
  ) {
    throw new Error(
      'A GitHub repository is required via --repository or PLAYRUNNER_REPOSITORY.',
    );
  }
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(baseSha)) {
    throw new Error(
      'A complete base commit SHA is required via --base-sha or PLAYRUNNER_BASE_SHA.',
    );
  }
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(headSha)) {
    throw new Error(
      'A complete head commit SHA is required via --head-sha or PLAYRUNNER_HEAD_SHA.',
    );
  }
  if (baseSha.toLowerCase() === headSha.toLowerCase()) {
    throw new Error('Base and head commit SHAs must be different.');
  }
  const safeRef = (value: string) =>
    /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/.test(value) &&
    value !== 'HEAD' &&
    !value.startsWith('refs/') &&
    !value.includes('..') &&
    !value.includes('//') &&
    !value.includes('@{') &&
    !value.endsWith('/') &&
    value
      .split('/')
      .every(
        (segment) =>
          Boolean(segment) &&
          !segment.startsWith('.') &&
          !segment.endsWith('.') &&
          !segment.endsWith('.lock'),
      );
  if (!safeRef(baseRef) || !safeRef(headRef)) {
    throw new Error('Complete safe base and head branch refs are required.');
  }
  if (!['manual', 'pull_request', 'push'].includes(eventType)) {
    throw new Error('Event type must be push, pull_request, or manual.');
  }
  let pullRequestNumber: number | undefined;
  if (pullRequest) {
    pullRequestNumber = Number(pullRequest);
    if (
      !Number.isSafeInteger(pullRequestNumber) ||
      pullRequestNumber < 1 ||
      pullRequestNumber > 2_147_483_647
    ) {
      throw new Error('Pull request number must be a positive integer.');
    }
  }
  if (eventType === 'pull_request' && pullRequestNumber === undefined) {
    throw new Error(
      'Pull request events require --pull-request or PLAYRUNNER_PULL_REQUEST_NUMBER.',
    );
  }
  if (eventType !== 'pull_request' && pullRequestNumber !== undefined) {
    throw new Error(
      'A pull request number is only valid when --event-type is pull_request.',
    );
  }

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
    acceptanceCriteria,
    apiKey,
    changeContext: {
      baseRef,
      baseSha: baseSha.toLowerCase(),
      eventType: eventType as NonNullable<
        Options['changeContext']
      >['eventType'],
      headRef,
      headSha: headSha.toLowerCase(),
      ...(pullRequestNumber ? { pullRequestNumber } : {}),
      repository: { name: repositoryMatch[2], owner: repositoryMatch[1] },
    },
    json,
    inputs,
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

function rateLimitWaitMs(response: Response, now: number) {
  const value = response.headers.get('retry-after')?.trim() ?? '';
  const seconds = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  const parsedDate = seconds >= 0 ? Number.NaN : Date.parse(value);
  const requested = Number.isFinite(seconds)
    ? seconds * 1_000
    : Number.isFinite(parsedDate)
      ? parsedDate - now
      : DEFAULT_POLL_INTERVAL_MS;
  return Math.min(
    MAX_RATE_LIMIT_WAIT_MS,
    Math.max(DEFAULT_POLL_INTERVAL_MS, requested),
  );
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

  if (args[0] === 'login' || args[0] === 'auth') {
    const signal = dependencies.signal ?? new AbortController().signal;
    try {
      return (
        (await runCompanionCommand(args, {
          env,
          fetch: fetchImpl,
          signal,
          stderr: outputError,
          stdout: output,
        })) ?? 2
      );
    } catch (error) {
      if (signal.aborted) return 130;
      outputError(
        `Playrunner companion failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return 2;
    }
  }

  if (args[0] === 'workflow' && args[1] === 'create') {
    return runWorkflowCreateCli(args.slice(2), {
      env,
      fetch: fetchImpl,
      readFile: dependencies.readFile,
      stderr: outputError,
      stdout: output,
    });
  }

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
      body: JSON.stringify({
        ...(options.changeContext ?? {}),
        ...(Object.keys(options.inputs).length
          ? { inputs: options.inputs }
          : {}),
        ...(options.acceptanceCriteria.length
          ? { acceptanceCriteria: options.acceptanceCriteria }
          : {}),
      }),
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
      let eventQueueDrained = false;
      let eventPagesRead = 0;
      while (eventPagesRead < MAX_EVENT_PAGES_PER_POLL && now() < deadline) {
        const previousCursor = cursor;
        const eventsResponse = await fetchImpl(
          `${basePath}/${encodeURIComponent(executionId)}/events?after=${encodeURIComponent(cursor)}`,
          { headers, signal: controller.signal },
        );
        const eventsPayload = await responseJson(eventsResponse);
        if (eventsResponse.status === 429) {
          await waitFor(
            Math.min(
              rateLimitWaitMs(eventsResponse, now()),
              Math.max(1, deadline - now()),
            ),
            controller.signal,
          );
          continue;
        }
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
        eventPagesRead += 1;
        if (events.length < EVENT_PAGE_SIZE) {
          eventQueueDrained = true;
          break;
        }
        if (cursor === previousCursor) {
          emitError('Playrunner returned an event page without a cursor.');
          return 2;
        }
      }

      if (!eventQueueDrained) {
        if (now() < deadline) {
          await waitFor(
            Math.min(DEFAULT_POLL_INTERVAL_MS, Math.max(1, deadline - now())),
            controller.signal,
          );
        }
        continue;
      }

      const statusResponse = await fetchImpl(
        `${basePath}/${encodeURIComponent(executionId)}`,
        { headers, signal: controller.signal },
      );
      const statusPayload = await responseJson(statusResponse);
      if (statusResponse.status === 429) {
        await waitFor(
          Math.min(
            rateLimitWaitMs(statusResponse, now()),
            Math.max(1, deadline - now()),
          ),
          controller.signal,
        );
        continue;
      }
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
