import crypto from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { AuthUser } from './auth.types';

const LOCAL_AUTH_ISSUER = 'playrunner-local';
const LOCAL_AUTH_AUDIENCE = 'playrunner-local';
const LOCAL_AUTH_SUBJECT = 'local-admin';

function getLocalAuthUsername() {
  const username = process.env.LOCAL_AUTH_USERNAME?.trim();
  if (!username) {
    throw new Error(
      'LOCAL_AUTH_USERNAME is not configured. Run ./start-local.sh --setup.',
    );
  }

  return username;
}

function getLocalAuthPasswordHash() {
  const passwordHash = process.env.LOCAL_AUTH_PASSWORD_HASH?.trim();
  if (!passwordHash) {
    throw new Error(
      'LOCAL_AUTH_PASSWORD_HASH is not configured. Run ./start-local.sh --setup.',
    );
  }

  return passwordHash;
}

function getLocalAuthSecret() {
  const secret = process.env.AUTH_JWT_SECRET?.trim();
  if (!secret) {
    throw new Error(
      'AUTH_JWT_SECRET is not configured. Run ./start-local.sh --setup.',
    );
  }

  return new TextEncoder().encode(secret);
}

function verifyPasswordHash(password: string, storedHash: string) {
  const [algorithm, salt, expectedHash] = storedHash.split('$');

  if (algorithm !== 'scrypt' || !salt || !expectedHash) {
    throw new Error(
      'LOCAL_AUTH_PASSWORD_HASH uses an unexpected format. Re-run ./start-local.sh --setup.',
    );
  }

  const derivedKey = crypto.scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expectedHash, 'hex');

  if (derivedKey.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(derivedKey, expectedBuffer);
}

export function isLocalAuthConfigured() {
  return Boolean(
    process.env.LOCAL_AUTH_USERNAME?.trim() &&
    process.env.LOCAL_AUTH_PASSWORD_HASH?.trim() &&
    process.env.AUTH_JWT_SECRET?.trim(),
  );
}

export function getLocalAuthIssuer() {
  return LOCAL_AUTH_ISSUER;
}

export function getLocalAuthPublicUser() {
  const username = getLocalAuthUsername();

  return {
    uid: LOCAL_AUTH_SUBJECT,
    username,
    name: username,
  };
}

export function verifyLocalCredentials(username: string, password: string) {
  const configuredUsername = getLocalAuthUsername();

  if (username.trim() !== configuredUsername) {
    return false;
  }

  return verifyPasswordHash(password, getLocalAuthPasswordHash());
}

export async function issueLocalAuthToken(username: string) {
  return new SignJWT({ username })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(LOCAL_AUTH_ISSUER)
    .setAudience(LOCAL_AUTH_AUDIENCE)
    .setSubject(LOCAL_AUTH_SUBJECT)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getLocalAuthSecret());
}

export async function verifyLocalAuthToken(token: string): Promise<AuthUser> {
  const { payload } = await jwtVerify(token, getLocalAuthSecret(), {
    issuer: LOCAL_AUTH_ISSUER,
    audience: LOCAL_AUTH_AUDIENCE,
  });

  const username =
    typeof payload.username === 'string' && payload.username.trim()
      ? payload.username.trim()
      : getLocalAuthUsername();

  return {
    provider: 'local',
    providerUserId:
      typeof payload.sub === 'string' ? payload.sub : LOCAL_AUTH_SUBJECT,
    name: username,
    username,
  };
}
