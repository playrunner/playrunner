export type TestProgress = {
  total: number;
  completed: number;
  passed: number;
  failed: number;
  skipped: number;
  running: number;
};

export function readTestProgress(value: unknown): TestProgress | null {
  if (!value || typeof value !== 'object') return null;
  const fields = [
    'total',
    'completed',
    'passed',
    'failed',
    'skipped',
    'running',
  ] as const;
  const input = value as Record<string, unknown>;
  if (
    !fields.every(
      (key) => Number.isSafeInteger(input[key]) && Number(input[key]) >= 0,
    )
  )
    return null;
  const result = Object.fromEntries(
    fields.map((key) => [key, input[key]]),
  ) as TestProgress;
  if (
    result.total > 10_000_000 ||
    result.completed > result.total ||
    result.completed !== result.passed + result.failed + result.skipped ||
    result.running > result.total - result.completed
  )
    return null;
  return result;
}

export type TestResultEvent = {
  evidenceId: string;
  title: string;
  project: string;
  file: string;
  status: 'passed' | 'failed' | 'skipped' | 'blocked';
  retry: number;
  duration: number;
  expectedFailure?: true;
};

/** Explicit bounded metadata only; never forward raw repository-supplied errors. */
export function readTestResultEvent(value: unknown): TestResultEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  for (const key of ['evidenceId', 'title', 'project', 'file'] as const) {
    if (
      typeof input[key] !== 'string' ||
      input[key].length > (key === 'title' ? 2000 : 1024) ||
      Array.from(input[key]).some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      )
    )
      return null;
  }
  if (input.expectedFailure !== undefined && input.expectedFailure !== true)
    return null;
  if (
    !input.evidenceId ||
    !input.title ||
    !input.file ||
    String(input.file).startsWith('/') ||
    String(input.file)
      .split(/[\\/]/)
      .some((part) => part === '..')
  )
    return null;
  if (
    !['passed', 'failed', 'skipped', 'blocked'].includes(String(input.status))
  )
    return null;
  if (
    !Number.isSafeInteger(input.retry) ||
    Number(input.retry) < 0 ||
    !Number.isFinite(input.duration) ||
    Number(input.duration) < 0
  )
    return null;
  return {
    evidenceId: input.evidenceId as string,
    title: input.title as string,
    project: input.project as string,
    file: input.file as string,
    status: input.status as TestResultEvent['status'],
    retry: input.retry as number,
    duration: input.duration as number,
    ...(input.expectedFailure === true
      ? { expectedFailure: true as const }
      : {}),
  };
}
