import crypto from 'node:crypto';

export const RUNNER_PROTOCOL_TOKEN_BYTES = 32;
export const MAX_RUNNER_PROTOCOL_PAYLOAD_BYTES = 9 * 1024 * 1024;
const MAX_RUNNER_PROTOCOL_DEPTH = 64;
const MAX_RUNNER_PROTOCOL_VALUES = 100_000;

function canonicalize(
  value: unknown,
  state: { values: number },
  depth = 0,
): unknown {
  state.values += 1;
  if (
    depth > MAX_RUNNER_PROTOCOL_DEPTH ||
    state.values > MAX_RUNNER_PROTOCOL_VALUES
  ) {
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

function unsignedPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => key !== 'protocolSignature'),
  );
}

export function createRunnerProtocolToken(): string {
  return crypto.randomBytes(RUNNER_PROTOCOL_TOKEN_BYTES).toString('base64url');
}

export function isRunnerProtocolToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(value) &&
    Buffer.from(value, 'base64url').length === RUNNER_PROTOCOL_TOKEN_BYTES
  );
}

export function signRunnerProtocolPayload(
  payload: Record<string, unknown>,
  protocolToken: string,
): string {
  if (!isRunnerProtocolToken(protocolToken)) {
    throw new Error('Runner protocol token is invalid.');
  }
  const canonicalPayload = JSON.stringify(
    canonicalize(unsignedPayload(payload), { values: 0 }),
  );
  if (
    Buffer.byteLength(canonicalPayload, 'utf8') >
    MAX_RUNNER_PROTOCOL_PAYLOAD_BYTES
  ) {
    throw new Error('Runner protocol payload is too large.');
  }
  return crypto
    .createHmac('sha256', Buffer.from(protocolToken, 'base64url'))
    .update(canonicalPayload)
    .digest('base64url');
}

export function withRunnerProtocolSignature<T extends Record<string, unknown>>(
  payload: T,
  protocolToken: string,
): T & { protocolSignature: string } {
  return {
    ...payload,
    protocolSignature: signRunnerProtocolPayload(payload, protocolToken),
  };
}

export function verifyRunnerProtocolPayload(
  payload: Record<string, unknown>,
  protocolToken: string,
): boolean {
  try {
    if (
      typeof payload.protocolSignature !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(payload.protocolSignature) ||
      !isRunnerProtocolToken(protocolToken)
    ) {
      return false;
    }
    const actual = Buffer.from(payload.protocolSignature, 'base64url');
    const expected = Buffer.from(
      signRunnerProtocolPayload(payload, protocolToken),
      'base64url',
    );
    return (
      actual.length === expected.length &&
      crypto.timingSafeEqual(actual, expected)
    );
  } catch {
    return false;
  }
}
