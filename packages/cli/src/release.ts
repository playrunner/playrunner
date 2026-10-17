import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import type { CliDependencies } from './run.js';

type JsonRecord = Record<string, unknown>;
type Candidate = {
  repository: string;
  commitSha: string;
  artifactDigest: string;
  environment: string;
  targetUrl: string;
};
type ReleaseOptions = {
  action: 'policy' | 'verify' | 'check';
  workflowId: string;
  executionId: string;
  candidateFile: string;
  policyVersion: string;
  maxAgeSeconds: number;
  timeoutMs: number;
  json: boolean;
  url: string;
  apiKey: string;
};
const HASH = /^[a-f0-9]{64}$/;
const OUTCOMES = new Set(['PASS', 'FAIL', 'BLOCKED', 'SKIPPED', 'NOT RUN']);
const TERMINAL = new Set([
  'completed',
  'failed',
  'cancelled',
  'failed_to_start',
]);
const PENDING = new Set(['starting', 'pending', 'queued', 'running']);
const CANDIDATE_FIELDS = [
  'repository',
  'commitSha',
  'artifactDigest',
  'environment',
  'targetUrl',
] as const;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function candidate(value: unknown): Candidate {
  const entry = record(value);
  if (
    !entry ||
    Object.keys(entry).length !== CANDIDATE_FIELDS.length ||
    !CANDIDATE_FIELDS.every((key) => text(entry[key])) ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(
      String(entry.repository),
    ) ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(String(entry.commitSha)) ||
    !/^sha256:[a-f0-9]{64}$/.test(String(entry.artifactDigest)) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(String(entry.environment))
  ) {
    throw new Error(
      'Candidate must contain repository (owner/name), lowercase commitSha, sha256 artifactDigest, environment slug, and targetUrl.',
    );
  }
  let url: URL;
  try {
    url = new URL(String(entry.targetUrl));
  } catch {
    throw new Error('Candidate targetUrl must be a valid HTTP or HTTPS URL.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    String(entry.targetUrl).length > 2048 ||
    /[?#\s\\]/.test(String(entry.targetUrl))
  )
    throw new Error(
      'Candidate targetUrl must use HTTP or HTTPS without credentials, query, or fragment.',
    );
  return entry as Candidate;
}
function usage() {
  return `Usage: playrunner release policy <workflow-id> [--json]
       playrunner release verify <workflow-id> --candidate <file> --policy-version <hash> [options]
       playrunner release check <workflow-id> --execution <id> --candidate <file> --policy-version <hash> [options]

Commands:
  policy  Read the current release policy and required checks
  verify  Start candidate verification and wait for a release verdict
  check   Recheck an existing execution immediately before release

Options:
  --candidate <file>      JSON release candidate manifest (required for verify/check)
  --policy-version <hash> Reviewed release policy version (required for verify/check)
  --execution <id>        Existing execution (required for check)
  --max-age <seconds>     Maximum evidence age, 1–86400 (default 3600)
  --timeout <duration>    Verify wait timeout, e.g. 30s, 10m, 1h (default 30m)
  --url <url>             Playrunner URL (or PLAYRUNNER_URL)
  --json                  Emit newline-delimited JSON
  --help                  Show this help

Environment:
  PLAYRUNNER_API_KEY      Machine API token
  PLAYRUNNER_URL          Playrunner server URL

Verify/check exit zero only for a matching, current PASS verdict with evidence.
These commands do not publish or deploy a release.`;
}
function parseOptions(args: string[], env: NodeJS.ProcessEnv): ReleaseOptions {
  const [action, workflowId, ...flags] = args;
  if (
    !['policy', 'verify', 'check'].includes(action) ||
    !text(workflowId) ||
    workflowId.startsWith('-')
  )
    throw new Error(
      'Specify release policy, verify, or check and a workflow ID.',
    );
  const options: ReleaseOptions = {
    action: action as ReleaseOptions['action'],
    workflowId,
    executionId: '',
    candidateFile: '',
    policyVersion: '',
    maxAgeSeconds: 3600,
    timeoutMs: 30 * 60 * 1000,
    json: false,
    url: env.PLAYRUNNER_URL?.trim() ?? '',
    apiKey: env.PLAYRUNNER_API_KEY?.trim() ?? '',
  };
  const allowed = new Set([
    '--url',
    ...(action !== 'policy'
      ? ['--candidate', '--policy-version', '--max-age']
      : []),
    ...(action === 'verify' ? ['--timeout'] : []),
    ...(action === 'check' ? ['--execution'] : []),
  ]);
  const seen = new Set<string>();
  for (let index = 0; index < flags.length; index++) {
    const flag = flags[index];
    if (flag === '--json') {
      options.json = true;
      continue;
    }
    if (!allowed.has(flag)) throw new Error(`Unknown option: ${flag}`);
    const value = flags[++index];
    if (!text(value) || value.startsWith('--'))
      throw new Error(`${flag} requires a value.`);
    if (seen.has(flag)) throw new Error(`${flag} may only be supplied once.`);
    seen.add(flag);
    if (flag === '--url') options.url = value;
    if (flag === '--candidate') options.candidateFile = value;
    if (flag === '--execution') options.executionId = value;
    if (flag === '--policy-version') options.policyVersion = value;
    if (flag === '--max-age') {
      if (!/^\d+$/.test(value)) throw new Error('Maximum age must be seconds.');
      options.maxAgeSeconds = Number(value);
    }
    if (flag === '--timeout') {
      const duration = /^(\d+)(ms|s|m|h)$/.exec(value);
      const scales: Record<string, number> = {
        ms: 1,
        s: 1000,
        m: 60_000,
        h: 3_600_000,
      };
      options.timeoutMs = duration
        ? Number(duration[1]) * scales[duration[2]]
        : 0;
      if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1)
        throw new Error('Timeout must be positive and use ms, s, m, or h.');
    }
  }
  if (
    !Number.isInteger(options.maxAgeSeconds) ||
    options.maxAgeSeconds < 1 ||
    options.maxAgeSeconds > 86400
  )
    throw new Error('Maximum age must be between 1 and 86400 seconds.');
  if (
    action !== 'policy' &&
    (!options.candidateFile || !HASH.test(options.policyVersion))
  )
    throw new Error(
      '--candidate and a lowercase 64-character --policy-version are required.',
    );
  if (action === 'check' && !options.executionId)
    throw new Error('--execution is required.');
  if (!options.url || !options.apiKey)
    throw new Error(
      'PLAYRUNNER_URL (or --url) and PLAYRUNNER_API_KEY are required.',
    );
  const url = new URL(options.url);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      'Playrunner URL must use HTTP or HTTPS without credentials, query, or fragment.',
    );
  options.url = url.toString().replace(/\/$/, '');
  return options;
}
function evidenceValid(value: unknown) {
  const evidence = record(value);
  return Boolean(
    evidence &&
    text(evidence.nodeId) &&
    ['node', 'test'].includes(String(evidence.kind)) &&
    typeof evidence.evidenceId === 'string' &&
    (evidence.kind === 'node' || text(evidence.evidenceId)) &&
    OUTCOMES.has(String(evidence.status)),
  );
}
function timestamp(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  )
    return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
    ? parsed
    : NaN;
}
function verdictValid(
  value: JsonRecord,
  expected: {
    candidate: Candidate;
    workflowId: string;
    executionId: string;
    policyVersion: string;
    maxAgeSeconds: number;
  },
  now: number,
) {
  if (
    value.schemaVersion !== 1 ||
    !['PASS', 'FAIL', 'BLOCKED'].includes(String(value.status)) ||
    typeof value.allowed !== 'boolean' ||
    value.allowed !== (value.status === 'PASS') ||
    value.workflowId !== expected.workflowId ||
    value.executionId !== expected.executionId ||
    value.policyVersion !== expected.policyVersion ||
    !(
      (typeof value.criteriaVersion === 'string' &&
        HASH.test(value.criteriaVersion)) ||
      (!value.allowed && value.criteriaVersion === null)
    ) ||
    !Array.isArray(value.reasons) ||
    !value.reasons.every(
      (reason) => text(record(reason)?.code) && text(record(reason)?.message),
    ) ||
    !Array.isArray(value.requirements) ||
    !value.requirements.every((item) => {
      const requirement = record(item);
      return (
        requirement &&
        text(requirement.id) &&
        text(requirement.reason) &&
        OUTCOMES.has(String(requirement.status)) &&
        Array.isArray(requirement.evidence) &&
        requirement.evidence.every(evidenceValid)
      );
    })
  )
    throw new Error(
      'Playrunner returned an invalid or mismatched release verdict. Release blocked.',
    );
  const actual = candidate(value.candidate);
  if (!CANDIDATE_FIELDS.every((key) => actual[key] === expected.candidate[key]))
    throw new Error(
      'Release verdict belongs to a different candidate. Release blocked.',
    );
  if (!value.allowed) return;
  const completed = timestamp(value.completedAt);
  const expires = timestamp(value.expiresAt);
  if (
    !Number.isFinite(completed) ||
    !Number.isFinite(expires) ||
    completed > now ||
    expires <= now ||
    expires <= completed ||
    now - completed > expected.maxAgeSeconds * 1000 ||
    expires - completed > expected.maxAgeSeconds * 1000 ||
    value.reasons.length ||
    value.requirements.length < 2 ||
    !value.requirements.some(
      (item) => (item as JsonRecord).id === 'RELEASE_IDENTITY',
    ) ||
    new Set(value.requirements.map((item) => (item as JsonRecord).id)).size !==
      value.requirements.length ||
    !value.requirements.every((item) => {
      const requirement = item as JsonRecord;
      const evidence = requirement.evidence as JsonRecord[];
      return (
        requirement.status === 'PASS' &&
        evidence.length > 0 &&
        evidence.every((item) => item.status === 'PASS')
      );
    })
  )
    throw new Error(
      'Release PASS is expired, incomplete, or unsupported by evidence. Release blocked.',
    );
}
export async function runReleaseCli(
  args: string[],
  dependencies: CliDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? console.log;
  const stderr = dependencies.stderr ?? console.error;
  if (args.includes('--help') || args.includes('-h')) {
    stdout(usage());
    return 0;
  }
  let options: ReleaseOptions;
  try {
    options = parseOptions(args, dependencies.env ?? process.env);
  } catch (error) {
    stderr((error as Error).message);
    return 2;
  }
  const safe = (message: string) =>
    message.split(options.apiKey).join('[redacted]');
  const emit = (type: string, value: JsonRecord, message: string) =>
    stdout(safe(options.json ? JSON.stringify({ type, ...value }) : message));
  const emitError = (message: string) =>
    stderr(
      safe(options.json ? JSON.stringify({ type: 'error', message }) : message),
    );
  const now = dependencies.now ?? Date.now;
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const abort = () => controller.abort(dependencies.signal?.reason);
  dependencies.signal?.addEventListener('abort', abort, { once: true });
  if (dependencies.signal?.aborted) abort();
  const deadline = now() + options.timeoutMs;
  const base = `${options.url}/api/v1/workflows/${encodeURIComponent(options.workflowId)}`;
  let startPending = false;
  let requestKey = '';
  const request = async (path: string, init: RequestInit = {}) => {
    controller.signal.throwIfAborted();
    const remaining = deadline - now();
    if (remaining <= 0)
      throw new Error('Release verification wait timed out. Release blocked.');
    const response = await fetchImpl(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
      redirect: 'error',
      signal: AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(Math.min(30_000, remaining)),
      ]),
    });
    const payload = record(await response.json());
    if (!response.ok)
      throw new Error(
        text(payload?.error)
          ? payload.error
          : `Playrunner request failed (${response.status}).`,
      );
    if (!payload)
      throw new Error(
        'Playrunner returned an invalid response. Release blocked.',
      );
    return payload;
  };
  try {
    if (options.action === 'policy') {
      const policy = await request('/release-policy');
      if (
        policy.workflowId !== options.workflowId ||
        typeof policy.policyVersion !== 'string' ||
        !HASH.test(policy.policyVersion) ||
        typeof policy.criteriaVersion !== 'string' ||
        !HASH.test(policy.criteriaVersion) ||
        !Array.isArray(policy.requirements) ||
        policy.requirements.length < 2 ||
        !policy.requirements.every((item) => text(record(item)?.id)) ||
        !policy.requirements.some(
          (item) => record(item)?.id === 'RELEASE_IDENTITY',
        )
      )
        throw new Error('Playrunner returned an invalid release policy.');
      emit('release_policy', policy, JSON.stringify(policy, null, 2));
      return 0;
    }
    const source = await (dependencies.readFile ?? readFile)(
      options.candidateFile,
      'utf8',
    );
    if (Buffer.byteLength(source) > 16 * 1024)
      throw new Error('Candidate manifest must be at most 16 KiB.');
    const manifest = candidate(JSON.parse(source));
    const release = {
      candidate: manifest,
      policyVersion: options.policyVersion,
      maxAgeSeconds: options.maxAgeSeconds,
    };
    let executionId = options.executionId;
    let lifecycle = '';
    if (options.action === 'verify') {
      requestKey = randomUUID();
      startPending = true;
      const started = await request('/executions', {
        method: 'POST',
        headers: { 'Idempotency-Key': requestKey },
        body: JSON.stringify({ release }),
      });
      if (
        !text(started.executionId) ||
        (started.workflowId !== undefined &&
          started.workflowId !== options.workflowId)
      )
        throw new Error('Playrunner returned an invalid start response.');
      executionId = started.executionId;
      startPending = false;
      emit(
        'started',
        { executionId, workflowId: options.workflowId, requestKey },
        `Release verification started: ${executionId}`,
      );
      while (now() < deadline) {
        const status = await request(
          `/executions/${encodeURIComponent(executionId)}`,
        );
        if (
          (status.executionId !== undefined &&
            status.executionId !== executionId) ||
          (status.workflowId !== undefined &&
            status.workflowId !== options.workflowId)
        )
          throw new Error(
            'Playrunner returned status for a different execution. Release blocked.',
          );
        lifecycle = String(status.status);
        if (TERMINAL.has(lifecycle)) break;
        if (!PENDING.has(lifecycle))
          throw new Error(
            'Playrunner returned an unknown execution status. Release blocked.',
          );
        const waitMs = Math.min(1000, Math.max(1, deadline - now()));
        if (dependencies.wait)
          await dependencies.wait(waitMs, controller.signal);
        else await sleep(waitMs, undefined, { signal: controller.signal });
      }
      if (!TERMINAL.has(lifecycle)) {
        emitError(
          `Release verification timed out. Execution ${executionId} may still be running; release blocked.`,
        );
        return 124;
      }
    }
    const verdict = await request(
      `/executions/${encodeURIComponent(executionId)}/release-verdict`,
      { method: 'POST', body: JSON.stringify(release) },
    );
    verdictValid(
      verdict,
      { ...release, workflowId: options.workflowId, executionId },
      now(),
    );
    if (
      options.action === 'verify' &&
      lifecycle !== 'completed' &&
      verdict.allowed
    )
      throw new Error(
        'Release PASS contradicts the execution outcome. Release blocked.',
      );
    emit(
      'release_verdict',
      verdict,
      `Release ${verdict.status}: ${executionId}${verdict.allowed ? '' : `\n${(verdict.reasons as JsonRecord[]).map((reason) => reason.message).join('\n')}`}`,
    );
    return verdict.allowed ? 0 : 1;
  } catch (error) {
    if (controller.signal.aborted) {
      emitError(
        'Release verification interrupted. Release blocked; an accepted execution may still be running.',
      );
      return 130;
    }
    emitError(
      `${(error as Error).message}${startPending ? ` Start outcome may be unknown; do not start another run blindly. Request key: ${requestKey}.` : ''}`,
    );
    return 2;
  } finally {
    dependencies.signal?.removeEventListener('abort', abort);
  }
}
