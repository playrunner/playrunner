import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

export const LOCAL_ORCHESTRATOR_AUTH_HEADER = 'x-playrunner-orchestrator-token';
export const GCP_ORCHESTRATOR_AUTH_MODE = 'gcp_identity';

const MAX_GOOGLE_ID_TOKEN_LENGTH = 16 * 1024;
const googleIdentityTokenVerifier = new OAuth2Client();

type GoogleIdentityTokenVerifier = Pick<OAuth2Client, 'verifyIdToken'>;

export function isLocalOrchestratorRequestAuthorized(
  expectedToken: string | undefined,
  providedToken: string | undefined,
): boolean {
  const expected = expectedToken?.trim() || '';
  if (!expected) return false;
  const provided = providedToken?.trim() || '';
  const expectedBytes = Buffer.from(expected, 'utf8');
  const providedBytes = Buffer.from(provided, 'utf8');
  return (
    expectedBytes.length === providedBytes.length &&
    crypto.timingSafeEqual(expectedBytes, providedBytes)
  );
}

function bearerToken(value: string | undefined): string | null {
  const normalized = value?.trim() || '';
  if (
    normalized.length < 'Bearer a.b.c'.length ||
    normalized.length > MAX_GOOGLE_ID_TOKEN_LENGTH
  ) {
    return null;
  }
  const match =
    /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(
      normalized,
    );
  return match?.[1] || null;
}

/**
 * Cloud Run verifies this token at its IAM edge. We verify it again in the
 * application so a future IAM/configuration regression cannot silently expose
 * the execution endpoints.
 */
export async function isGcpOrchestratorRequestAuthorized(
  {
    authorization,
    expectedAudience,
    expectedEmail,
    expectedSubject,
  }: {
    authorization: string | undefined;
    expectedAudience: string | undefined;
    expectedEmail: string | undefined;
    expectedSubject: string | undefined;
  },
  verifier: GoogleIdentityTokenVerifier = googleIdentityTokenVerifier,
): Promise<boolean> {
  const token = bearerToken(authorization);
  const audience = expectedAudience?.trim() || '';
  const email = expectedEmail?.trim().toLowerCase() || '';
  const subject = expectedSubject?.trim() || '';
  if (!token || !audience || !email || !subject) return false;

  try {
    const ticket = await verifier.verifyIdToken({
      audience,
      idToken: token,
    });
    const payload = ticket.getPayload();
    return (
      (payload?.iss === 'https://accounts.google.com' ||
        payload?.iss === 'accounts.google.com') &&
      payload.aud === audience &&
      payload.email?.trim().toLowerCase() === email &&
      payload.email_verified === true &&
      payload.sub === subject
    );
  } catch {
    return false;
  }
}
