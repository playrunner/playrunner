import crypto from 'node:crypto';

const TOKEN_BYTES = 32;
const MAX_DEPTH = 64;
const MAX_VALUES = 100_000;

function canonicalize(
  value: unknown,
  state: { values: number },
  depth = 0,
): unknown {
  state.values += 1;
  if (depth > MAX_DEPTH || state.values > MAX_VALUES) {
    throw new Error('Runner protocol payload exceeds structural limits.');
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry, state, depth + 1));
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalize(entry, state, depth + 1)]),
  );
}

function isToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(value) &&
    Buffer.from(value, 'base64url').length === TOKEN_BYTES
  );
}

function sign(payload: Record<string, unknown>, protocolToken: string): string {
  if (!isToken(protocolToken)) throw new Error('Protocol token is invalid.');
  const { protocolSignature: _protocolSignature, ...unsigned } = payload;
  return crypto
    .createHmac('sha256', Buffer.from(protocolToken, 'base64url'))
    .update(JSON.stringify(canonicalize(unsigned, { values: 0 })))
    .digest('base64url');
}

export function createRunnerProtocolToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

export function withRunnerProtocolSignature<T extends Record<string, unknown>>(
  payload: T,
  protocolToken: string,
): T & { protocolSignature: string } {
  return { ...payload, protocolSignature: sign(payload, protocolToken) };
}

export function verifyRunnerProtocolPayload(
  payload: Record<string, unknown>,
  protocolToken: string,
): boolean {
  try {
    if (
      !isToken(protocolToken) ||
      typeof payload.protocolSignature !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(payload.protocolSignature)
    ) {
      return false;
    }
    const actual = Buffer.from(payload.protocolSignature, 'base64url');
    const expected = Buffer.from(sign(payload, protocolToken), 'base64url');
    return (
      actual.length === expected.length &&
      crypto.timingSafeEqual(actual, expected)
    );
  } catch {
    return false;
  }
}
