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
