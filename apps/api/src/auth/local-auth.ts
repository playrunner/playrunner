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

function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derivedKey}`;
}

async function upsertLocalAuthSecret(
  secretKey: string,
  value: string,
  description: string,
) {
  await prisma.secret.upsert({
    where: {
      userId_secretKey: {
        userId: LOCAL_AUTH_SECRET_OWNER,
        secretKey,
      },
    },
    update: {
      description,
      value,
    },
    create: {
      description,
      secretKey,
      userId: LOCAL_AUTH_SECRET_OWNER,
      value,
    },
  });
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

function resolveSetupEmail(username: string) {
  return username.includes('@') ? username : null;
}

export async function getLocalAuthPublicUser() {
  const { username } = await readLocalAuthConfig();
  const email = resolveSetupEmail(username);
  const name = email ? email.split('@')[0] : username;

  return {
    email,
    name,
    uid: LOCAL_AUTH_SUBJECT,
    username,
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

export async function updateLocalAuthPassword(params: {
  currentPassword: string;
  newPassword: string;
}) {
  const config = await readLocalAuthConfig();
  const currentPassword = params.currentPassword;
  const newPassword = params.newPassword;

  if (!verifyPasswordHash(currentPassword, config.passwordHash)) {
    throw new Error('Current password is incorrect.');
  }

  if (!newPassword.trim()) {
    throw new Error('New password is required.');
  }

  if (newPassword.trim().length < 8) {
    throw new Error('New password must be at least 8 characters.');
  }

  await upsertLocalAuthSecret(
    LOCAL_AUTH_SECRET_KEYS.passwordHash,
    hashPassword(newPassword),
    'Local setup admin password hash.',
  );
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

  const config = await readLocalAuthConfig();
  const username =
    typeof payload.username === 'string' && payload.username.trim()
      ? payload.username.trim()
      : config.username;
  const publicUser = await getLocalAuthPublicUser();

  return {
    email: publicUser.email ?? undefined,
    provider: 'local',
    providerUserId:
      typeof payload.sub === 'string' ? payload.sub : LOCAL_AUTH_SUBJECT,
    name: publicUser.name,
    username,
  };
}
