import crypto from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { prisma } from '../lib/prisma';
import { AuthUser } from './auth.types';

const LOCAL_AUTH_ISSUER = 'playrunner-local';
const LOCAL_AUTH_AUDIENCE = 'playrunner-local';
const LOCAL_AUTH_SUBJECT = 'local-admin';
const LOCAL_AUTH_SECRET_OWNER = '__playrunner_local_auth__';
const LOCAL_AUTH_SECRET_KEYS = {
  jwtSecret: 'local.auth.jwt_secret',
  passwordHash: 'local.auth.password_hash',
  username: 'local.auth.username',
} as const;
const LOCAL_AUTH_NOT_CONFIGURED_MESSAGE =
  'Local auth is not configured. Run ./start-local.sh to reopen setup.';

type LocalAuthConfig = {
  jwtSecret: string;
  passwordHash: string;
  username: string;
};

async function readLocalAuthConfig(): Promise<LocalAuthConfig> {
  try {
    const secrets = await prisma.secret.findMany({
      where: {
        secretKey: {
          in: Object.values(LOCAL_AUTH_SECRET_KEYS),
        },
        userId: LOCAL_AUTH_SECRET_OWNER,
      },
    });

    const values = new Map(
      secrets.map((secret) => [secret.secretKey, secret.value.trim()]),
    );
    const username = values.get(LOCAL_AUTH_SECRET_KEYS.username) || '';
    const passwordHash = values.get(LOCAL_AUTH_SECRET_KEYS.passwordHash) || '';
    const jwtSecret = values.get(LOCAL_AUTH_SECRET_KEYS.jwtSecret) || '';

    if (!username || !passwordHash || !jwtSecret) {
      throw new Error(LOCAL_AUTH_NOT_CONFIGURED_MESSAGE);
    }

    return {
      jwtSecret,
      passwordHash,
      username,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === LOCAL_AUTH_NOT_CONFIGURED_MESSAGE
    ) {
      throw error;
    }

    throw new Error(LOCAL_AUTH_NOT_CONFIGURED_MESSAGE);
  }
}

async function getLocalAuthSecret() {
  const config = await readLocalAuthConfig();
  return new TextEncoder().encode(config.jwtSecret);
}

function verifyPasswordHash(password: string, storedHash: string) {
  const [algorithm, salt, expectedHash] = storedHash.split('$');

  if (algorithm !== 'scrypt' || !salt || !expectedHash) {
    throw new Error(
      'Stored local auth password data uses an unexpected format. Re-run ./start-local.sh to reopen setup.',
    );
  }

  const derivedKey = crypto.scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expectedHash, 'hex');

  if (derivedKey.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(derivedKey, expectedBuffer);
}

export async function isLocalAuthConfigured() {
  try {
    await readLocalAuthConfig();
    return true;
  } catch {
    return false;
  }
}

export function getLocalAuthIssuer() {
  return LOCAL_AUTH_ISSUER;
}

export async function getLocalAuthPublicUser() {
  const { username } = await readLocalAuthConfig();

  return {
    uid: LOCAL_AUTH_SUBJECT,
    username,
    name: username,
  };
}

export async function verifyLocalCredentials(
  username: string,
  password: string,
) {
  const config = await readLocalAuthConfig();

  if (username.trim() !== config.username) {
    return false;
  }

  return verifyPasswordHash(password, config.passwordHash);
}

export async function issueLocalAuthToken(username: string) {
  return new SignJWT({ username })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(LOCAL_AUTH_ISSUER)
    .setAudience(LOCAL_AUTH_AUDIENCE)
    .setSubject(LOCAL_AUTH_SUBJECT)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(await getLocalAuthSecret());
}

export async function verifyLocalAuthToken(token: string): Promise<AuthUser> {
  const { payload } = await jwtVerify(token, await getLocalAuthSecret(), {
    issuer: LOCAL_AUTH_ISSUER,
    audience: LOCAL_AUTH_AUDIENCE,
  });

  const username =
    typeof payload.username === 'string' && payload.username.trim()
      ? payload.username.trim()
      : (await readLocalAuthConfig()).username;

  return {
    provider: 'local',
    providerUserId:
      typeof payload.sub === 'string' ? payload.sub : LOCAL_AUTH_SUBJECT,
    name: username,
    username,
  };
}
