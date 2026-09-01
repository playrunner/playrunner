import { Prisma } from '../generated/prisma/client.cts';
import { prisma } from '../lib/prisma';
import {
  decryptSecretPayload,
  encryptSecretPayload,
} from './credential-crypto';

export const AUTHENTICATION_STATE_MAX_BYTES = 5 * 1024 * 1024;
export const AUTHENTICATION_METHOD = 'local_agent';

export type AuthenticationProfileStatus =
  | 'authenticated'
  | 'authenticating'
  | 'expired'
  | 'needs_reauth'
  | 'revoked'
  | 'unauthenticated';

export type AuthenticationSuccessConditionType =
  | 'element_visible'
  | 'url_exact'
  | 'url_prefix';

export type PlaywrightStorageState = {
  cookies: Array<{
    domain: string;
    expires: number;
    httpOnly: boolean;
    name: string;
    path: string;
    sameSite: 'Lax' | 'None' | 'Strict';
    secure: boolean;
    value: string;
  }>;
  origins: Array<{
    indexedDB?: unknown[];
    localStorage: Array<{ name: string; value: string }>;
    origin: string;
  }>;
};

type AuthenticationProfileRecord = {
  applicationLabel: string | null;
  authenticatedAt: Date | null;
  authenticationMethod: string;
  createdAt: Date;
  encryptedState: string | null;
  encryptionVersion: number | null;
  environmentId: string;
  expiresAt: Date | null;
  id: string;
  name: string;
  ownerUserId: string;
  revokedAt: Date | null;
  roleLabel: string | null;
  startUrl: string;
  status: string;
  successConditionType: string;
  successConditionValue: string;
  updatedAt: Date;
};

function httpError(message: string, statusCode: number, code: string) {
  return Object.assign(new Error(message), { code, statusCode });
}

function requiredTrimmedString(
  value: unknown,
  label: string,
  maximumLength: number,
) {
  if (typeof value !== 'string' || !value.trim()) {
    throw httpError(`${label} is required.`, 400, 'invalid_profile');
  }
  const normalized = value.trim();
  if (normalized.length > maximumLength) {
    throw httpError(
      `${label} must be at most ${maximumLength} characters.`,
      400,
      'invalid_profile',
    );
  }
  return normalized;
}

function optionalTrimmedString(
  value: unknown,
  label: string,
  maximumLength: number,
) {
  if (value === undefined || value === null || value === '') return null;
  return requiredTrimmedString(value, label, maximumLength);
}

export function normalizeAuthenticationStartUrl(value: unknown): string {
  const raw = requiredTrimmedString(value, 'Start URL', 2_048);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw httpError(
      'Start URL must be a valid HTTP(S) URL.',
      400,
      'invalid_start_url',
    );
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  ) {
    throw httpError(
      'Start URL must be a credential-free HTTP(S) URL.',
      400,
      'invalid_start_url',
    );
  }
  parsed.hash = '';
  return parsed.toString();
}

export function normalizeSuccessCondition(input: unknown): {
  type: AuthenticationSuccessConditionType;
  value: string;
} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw httpError(
      'Authentication success condition is required.',
      400,
      'invalid_success_condition',
    );
  }
  const candidate = input as Record<string, unknown>;
  if (
    candidate.type !== 'url_exact' &&
    candidate.type !== 'url_prefix' &&
    candidate.type !== 'element_visible'
  ) {
    throw httpError(
      'Authentication success condition type is invalid.',
      400,
      'invalid_success_condition',
    );
  }
  const value = requiredTrimmedString(
    candidate.value,
    'Success condition value',
    2_048,
  );
  if (candidate.type === 'url_exact' || candidate.type === 'url_prefix') {
    return {
      type: candidate.type,
      value: normalizeAuthenticationStartUrl(value),
    };
  }
  return { type: candidate.type, value };
}

function statusFor(profile: AuthenticationProfileRecord) {
  if (profile.revokedAt || profile.status === 'revoked') return 'revoked';
  if (
    profile.expiresAt &&
    profile.expiresAt.getTime() <= Date.now() &&
    profile.status === 'authenticated'
  ) {
    return 'expired';
  }
  return profile.status as AuthenticationProfileStatus;
}

export function serializeAuthenticationProfile(
  profile: AuthenticationProfileRecord,
) {
  return {
    applicationLabel: profile.applicationLabel,
    authenticatedAt: profile.authenticatedAt,
    authenticationMethod: profile.authenticationMethod,
    createdAt: profile.createdAt,
    credentialStatus: { configured: Boolean(profile.encryptedState) },
    environmentId: profile.environmentId,
    expiresAt: profile.expiresAt,
    id: profile.id,
    name: profile.name,
    roleLabel: profile.roleLabel,
    startUrl: profile.startUrl,
    status: statusFor(profile),
    successCondition: {
      type: profile.successConditionType,
      value: profile.successConditionValue,
    },
    updatedAt: profile.updatedAt,
  };
}

async function requireOwnedEnvironment(userId: string, environmentId: string) {
  const environment = await prisma.environment.findFirst({
    where: { id: environmentId, userId },
    select: { id: true },
  });
  if (!environment) {
    throw httpError('Environment not found.', 404, 'environment_not_found');
  }
}

export async function requireOwnedAuthenticationProfile(
  ownerUserId: string,
  id: string,
) {
  const profile = await prisma.authenticationProfile.findFirst({
    where: { id, ownerUserId },
  });
  if (!profile) {
    throw httpError(
      'Authentication Profile not found.',
      404,
      'authentication_profile_not_found',
    );
  }
  return profile;
}

export async function listAuthenticationProfiles(ownerUserId: string) {
  const profiles = await prisma.authenticationProfile.findMany({
    where: { ownerUserId },
    orderBy: { updatedAt: 'desc' },
  });
  return profiles.map(serializeAuthenticationProfile);
}

export async function createAuthenticationProfile(
  ownerUserId: string,
  input: unknown,
) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw httpError(
      'Authentication Profile is required.',
      400,
      'invalid_profile',
    );
  }
  const body = input as Record<string, unknown>;
  const environmentId = requiredTrimmedString(
    body.environmentId,
    'Environment',
    128,
  );
  const successCondition = normalizeSuccessCondition(body.successCondition);
  await requireOwnedEnvironment(ownerUserId, environmentId);
  try {
    const profile = await prisma.authenticationProfile.create({
      data: {
        applicationLabel: optionalTrimmedString(
          body.applicationLabel,
          'Application label',
          120,
        ),
        environmentId,
        name: requiredTrimmedString(body.name, 'Name', 120),
        ownerUserId,
        roleLabel: optionalTrimmedString(body.roleLabel, 'Role label', 120),
        startUrl: normalizeAuthenticationStartUrl(body.startUrl),
        successConditionType: successCondition.type,
        successConditionValue: successCondition.value,
      },
    });
    await recordAuthenticationProfileAudit({
      action: 'created',
      actorId: ownerUserId,
      outcome: 'success',
      profileId: profile.id,
    });
    return serializeAuthenticationProfile(profile);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw httpError(
        'An Authentication Profile with this name already exists.',
        409,
        'authentication_profile_name_conflict',
      );
    }
    throw error;
  }
}

export async function updateAuthenticationProfile(
  ownerUserId: string,
  id: string,
  input: unknown,
) {
  const current = await requireOwnedAuthenticationProfile(ownerUserId, id);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw httpError(
      'Authentication Profile is required.',
      400,
      'invalid_profile',
    );
  }
  const body = input as Record<string, unknown>;
  const environmentId =
    body.environmentId === undefined
      ? current.environmentId
      : requiredTrimmedString(body.environmentId, 'Environment', 128);
  await requireOwnedEnvironment(ownerUserId, environmentId);
  const successCondition =
    body.successCondition === undefined
      ? {
          type: current.successConditionType as AuthenticationSuccessConditionType,
          value: current.successConditionValue,
        }
      : normalizeSuccessCondition(body.successCondition);
  const identityChanged =
    environmentId !== current.environmentId ||
    (body.startUrl !== undefined &&
      normalizeAuthenticationStartUrl(body.startUrl) !== current.startUrl) ||
    successCondition.type !== current.successConditionType ||
    successCondition.value !== current.successConditionValue;

  try {
    const profile = await prisma.authenticationProfile.update({
      where: { id: current.id },
      data: {
        ...(body.applicationLabel === undefined
          ? {}
          : {
              applicationLabel: optionalTrimmedString(
                body.applicationLabel,
                'Application label',
                120,
              ),
            }),
        environmentId,
        ...(body.name === undefined
          ? {}
          : { name: requiredTrimmedString(body.name, 'Name', 120) }),
        ...(body.roleLabel === undefined
          ? {}
          : {
              roleLabel: optionalTrimmedString(
                body.roleLabel,
                'Role label',
                120,
              ),
            }),
        ...(body.startUrl === undefined
          ? {}
          : { startUrl: normalizeAuthenticationStartUrl(body.startUrl) }),
        successConditionType: successCondition.type,
        successConditionValue: successCondition.value,
        ...(identityChanged && current.encryptedState
          ? { status: 'needs_reauth' }
          : {}),
      },
    });
    await recordAuthenticationProfileAudit({
      action: 'updated',
      actorId: ownerUserId,
      outcome: 'success',
      profileId: profile.id,
    });
    return serializeAuthenticationProfile(profile);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw httpError(
        'An Authentication Profile with this name already exists.',
        409,
        'authentication_profile_name_conflict',
      );
    }
    throw error;
  }
}

function assertStorageState(
  value: unknown,
): asserts value is PlaywrightStorageState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw httpError(
      'Captured authentication state is invalid.',
      400,
      'invalid_authentication_state',
    );
  }
  const state = value as Record<string, unknown>;
  if (!Array.isArray(state.cookies) || !Array.isArray(state.origins)) {
    throw httpError(
      'Captured authentication state is invalid.',
      400,
      'invalid_authentication_state',
    );
  }
  if (
    Buffer.byteLength(JSON.stringify(value), 'utf8') >
    AUTHENTICATION_STATE_MAX_BYTES
  ) {
    throw httpError(
      'Captured authentication state is too large.',
      413,
      'authentication_state_too_large',
    );
  }
}

function stateIdentity(ownerUserId: string, profileId: string) {
  return [ownerUserId, 'authentication_profile', profileId, 'storage_state'];
}

export function knownStorageStateExpiry(
  state: PlaywrightStorageState,
  now = Date.now(),
) {
  const expiries = state.cookies
    .map((cookie) => Number(cookie.expires))
    .filter((expires) => Number.isFinite(expires) && expires > now / 1_000)
    .map((expires) => expires * 1_000);
  return expiries.length ? new Date(Math.min(...expiries)) : null;
}

export async function storeAuthenticationState(args: {
  actorId: string;
  profileId: string;
  sessionId: string;
  state: unknown;
}) {
  const profile = await requireOwnedAuthenticationProfile(
    args.actorId,
    args.profileId,
  );
  assertStorageState(args.state);
  const encrypted = encryptSecretPayload(
    args.state,
    stateIdentity(profile.ownerUserId, profile.id),
  );
  const updated = await prisma.authenticationProfile.update({
    where: { id: profile.id },
    data: {
      authenticatedAt: new Date(),
      encryptedState: encrypted.encryptedValue,
      encryptionVersion: encrypted.encryptionVersion,
      expiresAt: knownStorageStateExpiry(args.state),
      revokedAt: null,
      status: 'authenticated',
    },
  });
  await recordAuthenticationProfileAudit({
    action: profile.encryptedState ? 'reauthenticated' : 'authenticated',
    actorId: args.actorId,
    outcome: 'success',
    profileId: profile.id,
    sessionId: args.sessionId,
  });
  return serializeAuthenticationProfile(updated);
}

export async function resolveAuthenticationState(
  ownerUserId: string,
  profileId: string,
) {
  const profile = await requireOwnedAuthenticationProfile(
    ownerUserId,
    profileId,
  );
  const effectiveStatus = statusFor(profile);
  if (
    effectiveStatus !== 'authenticated' ||
    !profile.encryptedState ||
    !profile.encryptionVersion
  ) {
    throw httpError(
      `Authentication Profile cannot be used while it is ${effectiveStatus}.`,
      409,
      'authentication_profile_unavailable',
    );
  }
  const state = decryptSecretPayload(
    profile.encryptedState,
    profile.encryptionVersion,
    stateIdentity(profile.ownerUserId, profile.id),
  );
  assertStorageState(state);
  return { profile, state };
}

export async function setAuthenticationProfileStatus(
  ownerUserId: string,
  profileId: string,
  status: AuthenticationProfileStatus,
) {
  const profile = await requireOwnedAuthenticationProfile(
    ownerUserId,
    profileId,
  );
  return prisma.authenticationProfile.update({
    where: { id: profile.id },
    data: { status },
  });
}

export async function recoverInterruptedAuthenticationProfiles() {
  const profiles = await prisma.authenticationProfile.findMany({
    where: { status: 'authenticating' },
  });
  await Promise.all(
    profiles.map(async (profile) => {
      const status = profile.revokedAt
        ? 'revoked'
        : profile.encryptedState
          ? 'authenticated'
          : 'unauthenticated';
      await prisma.authenticationProfile.update({
        where: { id: profile.id },
        data: { status },
      });
      await recordAuthenticationProfileAudit({
        action: 'authentication_interrupted',
        actorId: profile.ownerUserId,
        outcome: 'cancelled',
        profileId: profile.id,
      });
    }),
  );
}

export async function revokeAuthenticationProfile(
  ownerUserId: string,
  profileId: string,
) {
  const profile = await requireOwnedAuthenticationProfile(
    ownerUserId,
    profileId,
  );
  const updated = await prisma.authenticationProfile.update({
    where: { id: profile.id },
    data: {
      encryptedState: null,
      encryptionVersion: null,
      expiresAt: null,
      revokedAt: new Date(),
      status: 'revoked',
    },
  });
  await recordAuthenticationProfileAudit({
    action: 'revoked',
    actorId: ownerUserId,
    outcome: 'success',
    profileId,
  });
  return serializeAuthenticationProfile(updated);
}

export async function deleteAuthenticationProfile(
  ownerUserId: string,
  profileId: string,
) {
  const profile = await requireOwnedAuthenticationProfile(
    ownerUserId,
    profileId,
  );
  await recordAuthenticationProfileAudit({
    action: 'deleted',
    actorId: ownerUserId,
    outcome: 'success',
    profileId,
  });
  await prisma.authenticationProfile.delete({ where: { id: profile.id } });
}

export async function recordAuthenticationProfileAudit(args: {
  action: string;
  actorId: string;
  executionId?: string;
  outcome: string;
  profileId: string;
  sessionId?: string;
}) {
  await prisma.authenticationProfileAudit.create({ data: args });
}
