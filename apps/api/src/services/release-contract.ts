export type ReleaseCandidate = {
  repository: string;
  commitSha: string;
  artifactDigest: string;
  environment: string;
  targetUrl: string;
};

export type ReleaseRequest = {
  candidate: ReleaseCandidate;
  policyVersion: string;
  maxAgeSeconds: number;
};

export const RELEASE_IDENTITY_CASE = 'RELEASE_IDENTITY';
export const DEFAULT_RELEASE_MAX_AGE_SECONDS = 3600;
export const MAX_RELEASE_MAX_AGE_SECONDS = 86400;

export class ReleaseValidationError extends Error {}

function object(value: unknown, keys: string[], label: string) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new ReleaseValidationError(`${label} contains invalid fields.`);
  return value as Record<string, unknown>;
}

export function parseReleaseCandidate(value: unknown): ReleaseCandidate {
  const candidate = object(
    value,
    ['repository', 'commitSha', 'artifactDigest', 'environment', 'targetUrl'],
    'Release candidate',
  );
  const patterns = {
    repository:
      /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/,
    commitSha: /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/,
    artifactDigest: /^sha256:[a-f0-9]{64}$/,
    environment: /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/,
  };
  for (const [field, pattern] of Object.entries(patterns)) {
    if (typeof candidate[field] !== 'string' || !pattern.test(candidate[field]))
      throw new ReleaseValidationError(
        `Release candidate ${field} is invalid.`,
      );
  }
  try {
    if (
      typeof candidate.targetUrl !== 'string' ||
      candidate.targetUrl.length > 2048
    )
      throw new Error();
    const url = new URL(candidate.targetUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      candidate.targetUrl.trim() !== candidate.targetUrl ||
      /[\s\\?#]/.test(candidate.targetUrl)
    )
      throw new Error();
  } catch {
    throw new ReleaseValidationError(
      'Release targetUrl must be an HTTP(S) URL without credentials, query or fragment.',
    );
  }
  return {
    repository: candidate.repository as string,
    commitSha: candidate.commitSha as string,
    artifactDigest: candidate.artifactDigest as string,
    environment: candidate.environment as string,
    targetUrl: candidate.targetUrl as string,
  };
}

export function parseReleaseRequest(value: unknown): ReleaseRequest {
  const request = object(
    value,
    ['candidate', 'policyVersion', 'maxAgeSeconds'],
    'Release request',
  );
  if (
    typeof request.policyVersion !== 'string' ||
    !/^[a-f0-9]{64}$/.test(request.policyVersion)
  )
    throw new ReleaseValidationError(
      'Release policyVersion must be a lowercase SHA-256 hash.',
    );
  const age = request.maxAgeSeconds ?? DEFAULT_RELEASE_MAX_AGE_SECONDS;
  if (
    typeof age !== 'number' ||
    !Number.isInteger(age) ||
    age < 1 ||
    age > MAX_RELEASE_MAX_AGE_SECONDS
  )
    throw new ReleaseValidationError(
      'Release maxAgeSeconds must be an integer from 1 to 86400.',
    );
  return {
    candidate: parseReleaseCandidate(request.candidate),
    policyVersion: request.policyVersion,
    maxAgeSeconds: age,
  };
}

export function sameReleaseCandidate(a: ReleaseCandidate, b: ReleaseCandidate) {
  return (Object.keys(a) as Array<keyof ReleaseCandidate>).every(
    (key) => a[key] === b[key],
  );
}
