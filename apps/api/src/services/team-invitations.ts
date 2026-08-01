import crypto from 'node:crypto';

export const TEAM_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type TeamInvitationStatus =
  | 'pending'
  | 'accepted'
  | 'revoked'
  | 'expired';

export function normalizeEmail(value: string) {
  return value.trim().toLocaleLowerCase('en-US');
}

export function isValidEmail(value: string) {
  const normalized = normalizeEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

export function createInvitationToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashInvitationToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function getInvitationStatus(
  status: string,
  expiresAt: Date,
  now = new Date(),
): TeamInvitationStatus {
  if (status === 'pending' && expiresAt.getTime() <= now.getTime()) {
    return 'expired';
  }

  if (status === 'accepted' || status === 'revoked' || status === 'expired') {
    return status;
  }

  return 'pending';
}

export function verifiedEmailMatches(
  authenticatedEmail: string | undefined,
  emailVerified: boolean | undefined,
  invitedEmail: string,
) {
  return (
    emailVerified === true &&
    Boolean(authenticatedEmail) &&
    normalizeEmail(authenticatedEmail ?? '') === normalizeEmail(invitedEmail)
  );
}
