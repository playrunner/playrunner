const MAX_PROHIBITED_EXACT_VALUES = 8;
const MAX_PROHIBITED_EXACT_VALUE_BYTES = 16 * 1024;
const REDACTED_VALUE = '[redacted]';

export const CREDENTIAL_LEAK_MESSAGE =
  'AI Container blocked output that contained a credential value.';

export function normalizeProhibitedExactValues(
  values: readonly (string | undefined)[] = [],
): string[] {
  const normalized = Array.from(
    new Set(values.map((value) => String(value || '')).filter(Boolean)),
  );
  if (
    normalized.length > MAX_PROHIBITED_EXACT_VALUES ||
    normalized.some(
      (value) =>
        Buffer.byteLength(value, 'utf8') > MAX_PROHIBITED_EXACT_VALUE_BYTES,
    )
  ) {
    throw new Error('Prohibited credential values exceed the safety limit.');
  }
  return normalized.sort((left, right) => right.length - left.length);
}

export function containsProhibitedExactValue(
  content: string | Buffer,
  values: readonly string[],
): boolean {
  if (!values.length) return false;
  const bytes = Buffer.isBuffer(content)
    ? content
    : Buffer.from(content, 'utf8');
  return values.some((value) => bytes.includes(Buffer.from(value, 'utf8')));
}

export function redactProhibitedExactValues(
  value: string,
  values: readonly string[],
): string {
  let redacted = value;
  for (const prohibited of values) {
    redacted = redacted.split(prohibited).join(REDACTED_VALUE);
  }
  return redacted;
}

export function credentialSafeErrorMessage(
  error: unknown,
  values: readonly string[],
): string {
  const message = error instanceof Error ? error.message : String(error);
  return containsProhibitedExactValue(message, values)
    ? CREDENTIAL_LEAK_MESSAGE
    : redactProhibitedExactValues(message, values);
}

export function assertNoProhibitedExactValues(
  value: string | Buffer,
  values: readonly string[],
): void {
  if (containsProhibitedExactValue(value, values)) {
    throw new Error(CREDENTIAL_LEAK_MESSAGE);
  }
}

export function redactProhibitedExactValuesDeep(
  value: unknown,
  values: readonly string[],
): unknown {
  if (!values.length) return value;
  if (typeof value === 'string') {
    return redactProhibitedExactValues(value, values);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactProhibitedExactValuesDeep(item, values));
  }
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[redactProhibitedExactValues(key, values)] =
      redactProhibitedExactValuesDeep(item, values);
  }
  return result;
}
