export const MAX_CI_CHANGE_CONTEXT_BYTES = 8 * 1024;

const SAFE_TOP_LEVEL_FIELDS = new Set([
  'baseRef',
  'baseSha',
  'eventType',
  'headRef',
  'headSha',
  'pullRequestNumber',
  'repository',
]);
const SAFE_REPOSITORY_FIELDS = new Set(['name', 'owner']);
const SAFE_EVENT_TYPES = new Set(['manual', 'pull_request', 'push']);
const SHA_PATTERN = /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/;
const REPOSITORY_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export type CiChangeContext = {
  baseRef: string;
  baseSha: string;
  eventType: 'manual' | 'pull_request' | 'push';
  headRef: string;
  headSha: string;
  pullRequestNumber?: number;
  repository: string;
};

export class CiChangeContextValidationError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertOnlyFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  location: string,
) {
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new CiChangeContextValidationError(
      `${location} contains an unsupported field.`,
    );
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value !== value.trim() || !value) {
    throw new CiChangeContextValidationError(`${field} is required.`);
  }
  return value;
}

function safeSha(value: unknown, field: string): string {
  const sha = requiredString(value, field);
  if (!SHA_PATTERN.test(sha)) {
    throw new CiChangeContextValidationError(
      `${field} must be a 40 or 64 character hexadecimal commit SHA.`,
    );
  }
  return sha.toLowerCase();
}

function safeRef(value: unknown, field: string): string {
  const ref = requiredString(value, field);
  const segments = ref.split('/');
  if (
    Buffer.byteLength(ref, 'utf8') > 255 ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref) ||
    ref === 'HEAD' ||
    ref.startsWith('refs/') ||
    ref.startsWith('-') ||
    ref.endsWith('/') ||
    ref.endsWith('.') ||
    ref.includes('..') ||
    ref.includes('//') ||
    ref.includes('@{') ||
    segments.some(
      (segment) =>
        !segment ||
        segment.startsWith('.') ||
        segment.endsWith('.lock') ||
        segment.endsWith('.'),
    )
  ) {
    throw new CiChangeContextValidationError(
      `${field} is not a safe branch name.`,
    );
  }
  return ref;
}

function safeRepository(value: unknown): string {
  if (!isRecord(value)) {
    throw new CiChangeContextValidationError(
      'repository must contain owner and name.',
    );
  }
  assertOnlyFields(value, SAFE_REPOSITORY_FIELDS, 'repository');
  const owner = requiredString(value.owner, 'repository.owner');
  const name = requiredString(value.name, 'repository.name');
  if (
    !REPOSITORY_SEGMENT_PATTERN.test(owner) ||
    !REPOSITORY_SEGMENT_PATTERN.test(name) ||
    Buffer.byteLength(`${owner}/${name}`, 'utf8') > 200 ||
    owner === '.' ||
    owner === '..' ||
    owner.endsWith('-') ||
    name === '.' ||
    name === '..' ||
    name.endsWith('-')
  ) {
    throw new CiChangeContextValidationError(
      'repository owner and name must be safe path segments.',
    );
  }
  return `${owner}/${name}`.toLowerCase();
}

function serializedSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function parseCiChangeContext(value: unknown): CiChangeContext {
  if (!isRecord(value)) {
    throw new CiChangeContextValidationError(
      'A CI change context JSON object is required.',
    );
  }
  if (serializedSize(value) > MAX_CI_CHANGE_CONTEXT_BYTES) {
    throw new CiChangeContextValidationError(
      `CI change context exceeds ${MAX_CI_CHANGE_CONTEXT_BYTES} bytes.`,
    );
  }
  assertOnlyFields(value, SAFE_TOP_LEVEL_FIELDS, 'CI change context');

  const eventType = value.eventType ?? 'manual';
  if (typeof eventType !== 'string' || !SAFE_EVENT_TYPES.has(eventType)) {
    throw new CiChangeContextValidationError(
      'eventType must be push, pull_request, or manual.',
    );
  }

  let pullRequestNumber: number | undefined;
  if (value.pullRequestNumber !== undefined) {
    if (
      !Number.isSafeInteger(value.pullRequestNumber) ||
      Number(value.pullRequestNumber) < 1 ||
      Number(value.pullRequestNumber) > 2_147_483_647
    ) {
      throw new CiChangeContextValidationError(
        'pullRequestNumber must be a positive 32-bit integer.',
      );
    }
    pullRequestNumber = Number(value.pullRequestNumber);
  }
  if (eventType === 'pull_request' && pullRequestNumber === undefined) {
    throw new CiChangeContextValidationError(
      'pullRequestNumber is required for pull_request events.',
    );
  }
  if (eventType !== 'pull_request' && pullRequestNumber !== undefined) {
    throw new CiChangeContextValidationError(
      'pullRequestNumber is only allowed for pull_request events.',
    );
  }

  const baseSha = safeSha(value.baseSha, 'baseSha');
  const headSha = safeSha(value.headSha, 'headSha');
  if (baseSha === headSha) {
    throw new CiChangeContextValidationError(
      'baseSha and headSha must identify different commits.',
    );
  }

  return {
    baseRef: safeRef(value.baseRef, 'baseRef'),
    baseSha,
    eventType: eventType as CiChangeContext['eventType'],
    headRef: safeRef(value.headRef, 'headRef'),
    headSha,
    ...(pullRequestNumber === undefined ? {} : { pullRequestNumber }),
    repository: safeRepository(value.repository),
  };
}
