import crypto from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { prisma } from '../lib/prisma';
import { AuthUser } from './auth.types';

const LOCAL_AUTH_ISSUER = 'playrunner-local';
const LOCAL_AUTH_AUDIENCE = 'playrunner-local';
const LOCAL_AUTH_SUBJECT = 'local-admin';
const LOCAL_AUTH_NOT_CONFIGURED_MESSAGE =
  'Local auth is not configured. Run ./start-local.sh to reopen setup.';

type LocalAuthConfig = {
  email: string | null;
  id: string;
  passwordHash: string;
  username: string;
};

function getLocalAuthJwtSecret() {
  const jwtSecret = process.env.PLAYRUNNER_LOCAL_AUTH_JWT_SECRET?.trim() || '';
  if (jwtSecret.length < 32) {
    throw new Error(LOCAL_AUTH_NOT_CONFIGURED_MESSAGE);
  }

  return jwtSecret;
}

async function readLocalAuthConfig(): Promise<LocalAuthConfig> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: LOCAL_AUTH_SUBJECT },
    });
    if (!user?.username.trim() || !user.passwordHash.trim()) {
      throw new Error(LOCAL_AUTH_NOT_CONFIGURED_MESSAGE);
    }
    getLocalAuthJwtSecret();

    return {
      email: user.email,
      id: user.id,
      passwordHash: user.passwordHash,
      username: user.username,
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

export async function configureLocalAuth(params: {
  password: string;
  username: string;
}) {
  const username = params.username.trim();
  if (!username) throw new Error('Local auth username is required.');
  if (params.password.trim().length < 8) {
    throw new Error('Local auth password must be at least 8 characters.');
  }

  const email = resolveSetupEmail(username);
  const passwordHash = hashPassword(params.password);
  await prisma.user.upsert({
    where: { id: LOCAL_AUTH_SUBJECT },
    update: {
      email,
      passwordHash,
      username,
    },
    create: {
      email,
      id: LOCAL_AUTH_SUBJECT,
      passwordHash,
      username,
    },
  });
}

async function getLocalAuthSecret() {
  await readLocalAuthConfig();
  return new TextEncoder().encode(getLocalAuthJwtSecret());
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
  const { email, id, username } = await readLocalAuthConfig();
  const name = email ? email.split('@')[0] : username;

  return {
    email,
    name,
    uid: id,
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

  await prisma.user.update({
    where: { id: config.id },
    data: { passwordHash: hashPassword(newPassword) },
  });
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
  const tokenUsername =
    typeof payload.username === 'string' && payload.username.trim()
      ? payload.username.trim()
      : config.username;
  const publicUser = await getLocalAuthPublicUser();

  return {
    email: publicUser.email ?? undefined,
    provider: 'local',
    providerUserId: typeof payload.sub === 'string' ? payload.sub : config.id,
    name: publicUser.name,
    username: tokenUsername,
  };
}
