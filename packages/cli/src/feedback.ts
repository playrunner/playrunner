import type { CliDependencies } from './run.js';

const usage = `Usage: playrunner feedback <workflow-id> <execution-id> [options]

Inspect an existing execution. This command never starts a workflow.

Options:
  --after <cursor>  Read changes after the returned nextCursor (default 0)
  --url <url>       Playrunner server URL (or PLAYRUNNER_URL)
  --json            Emit the complete bounded feedback response as JSON
  --help            Show this help

Environment:
  PLAYRUNNER_API_KEY  Machine API token with access to this workflow
  PLAYRUNNER_URL      Playrunner server URL`;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export async function runFeedbackCli(
  args: string[],
  dependencies: CliDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? console.log;
  const stderr = dependencies.stderr ?? console.error;
  if (args.includes('--help') || args.includes('-h')) {
    stdout(usage);
    return 0;
  }
  const env = dependencies.env ?? process.env;
  const apiKey = env.PLAYRUNNER_API_KEY?.trim() ?? '';
  let json = false;
  let after = '0';
  let url = env.PLAYRUNNER_URL?.trim() ?? '';
  const ids: string[] = [];
  const redact = (value: string) =>
    apiKey ? value.split(apiKey).join('[redacted]') : value;
  try {
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === '--json') json = true;
      else if (arg === '--url' || arg === '--after') {
        const value = args[++index];
        if (!value || value.startsWith('--'))
          throw new Error(`${arg} requires a value.`);
        if (arg === '--url') url = value;
        else after = value;
      } else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
      else ids.push(arg);
    }
    if (ids.length !== 2 || ids.some((id) => !id.trim()))
      throw new Error('A workflow ID and execution ID are required.');
    if (!/^\d{1,19}$/.test(after) || BigInt(after) > 9223372036854775807n)
      throw new Error('--after must be a non-negative event cursor.');
    if (!apiKey) throw new Error('PLAYRUNNER_API_KEY is required.');
    if (!url) throw new Error('PLAYRUNNER_URL or --url is required.');
    const base = new URL(url);
    if (!['http:', 'https:'].includes(base.protocol))
      throw new Error('The Playrunner URL must use HTTP or HTTPS.');
    base.username = '';
    base.password = '';
    base.search = '';
    base.hash = '';
    const endpoint = `${base.toString().replace(/\/$/, '')}/api/v1/workflows/${encodeURIComponent(ids[0])}/executions/${encodeURIComponent(ids[1])}/feedback?after=${encodeURIComponent(after)}`;
    const response = await (dependencies.fetch ?? globalThis.fetch)(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: dependencies.signal,
    });
    const payload = record(await response.json().catch(() => ({})));
    if (!response.ok)
      throw new Error(
        typeof payload.error === 'string'
          ? payload.error
          : `Playrunner returned HTTP ${response.status}.`,
      );
    // Redact nested error excerpts as well as top-level strings.
    const safe = JSON.parse(redact(JSON.stringify(payload))) as Record<
      string,
      unknown
    >;
    if (json) stdout(JSON.stringify(safe));
    else {
      stdout(`Execution ${ids[1]}: ${String(safe.status ?? 'unknown')}`);
      const progress = record(safe.progress);
      if (Object.keys(progress).length)
        stdout(
          `Tests: ${progress.completed}/${progress.total} completed; ${progress.passed} passed, ${progress.failed} failed, ${progress.skipped} skipped.`,
        );
      if (
        typeof safe.expectedFailureCount === 'number' &&
        safe.expectedFailureCount > 0
      )
        stdout(
          `Failures expected by test configuration: ${safe.expectedFailureCount}. These do not establish a baseline or passing release evidence.`,
        );
      for (const failure of Array.isArray(safe.failures) ? safe.failures : []) {
        const item = record(failure);
        stdout(
          `Failure: ${String(item.title ?? item.nodeId ?? 'Unknown test')}`,
        );
        if (typeof item.error === 'string') stdout(item.error);
      }
      for (const artifact of Array.isArray(safe.artifacts)
        ? safe.artifacts
        : []) {
        const item = record(artifact);
        stdout(`Report: ${String(item.path ?? '')}`);
      }
      if (safe.truncated)
        stdout(
          'Feedback is truncated; inspect the linked report for complete evidence.',
        );
      stdout(
        `Next cursor: ${String(safe.nextCursor ?? after)}${safe.hasMore ? ' (more changes available)' : ''}.`,
      );
    }
    return 0;
  } catch (error) {
    if (dependencies.signal?.aborted) return 130;
    const message = redact(
      error instanceof Error ? error.message : 'Feedback could not be read.',
    );
    stderr(json ? JSON.stringify({ type: 'error', message }) : message);
    return 2;
  }
}
