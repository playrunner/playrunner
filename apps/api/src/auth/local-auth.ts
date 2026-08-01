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

export type LocalAuthPublicUser = {
  email: string | null;
  name: string;
  uid: string;
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

async function readLocalAuthUser(userId: string): Promise<LocalAuthConfig> {
  await readLocalAuthConfig();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.username.trim() || !user.passwordHash.trim()) {
    throw new Error('Local user account not found.');
  }

  return {
    email: user.email,
    id: user.id,
    passwordHash: user.passwordHash,
    username: user.username,
  };
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

export async function getLocalAuthPublicUser(
  userId = LOCAL_AUTH_SUBJECT,
): Promise<LocalAuthPublicUser> {
  const { email, id, username } = await readLocalAuthUser(userId);
  const name = email ? email.split('@')[0] : username;

  return {
    email,
    name,
    uid: id,
    username,
  };
}

export async function authenticateLocalCredentials(
  username: string,
  password: string,
) {
  await readLocalAuthConfig();
  const config = await prisma.user.findUnique({
    where: { username: username.trim() },
  });
  if (!config || !verifyPasswordHash(password, config.passwordHash)) {
    return null;
  }

  return getLocalAuthPublicUser(config.id);
}

export async function updateLocalAuthPassword(params: {
  currentPassword: string;
  newPassword: string;
  userId: string;
}) {
  const config = await readLocalAuthUser(params.userId);
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

export async function issueLocalAuthToken(userId: string, username: string) {
  return new SignJWT({ username })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(LOCAL_AUTH_ISSUER)
    .setAudience(LOCAL_AUTH_AUDIENCE)
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(await getLocalAuthSecret());
}

export async function verifyLocalAuthToken(token: string): Promise<AuthUser> {
  const { payload } = await jwtVerify(token, await getLocalAuthSecret(), {
    issuer: LOCAL_AUTH_ISSUER,
    audience: LOCAL_AUTH_AUDIENCE,
  });

  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new Error('Token is missing its local user subject.');
  }
  const config = await readLocalAuthUser(payload.sub);
  const tokenUsername =
    typeof payload.username === 'string' && payload.username.trim()
      ? payload.username.trim()
      : config.username;
  const publicUser = await getLocalAuthPublicUser(config.id);

  return {
    email: publicUser.email ?? undefined,
    emailVerified: Boolean(publicUser.email),
    provider: 'local',
    providerUserId: config.id,
    name: publicUser.name,
    username: tokenUsername,
  };
}

export async function createInvitedLocalUser(params: {
  email: string;
  password: string;
}) {
  const email = params.email.trim().toLocaleLowerCase('en-US');
  if (!email) throw new Error('Email address is required.');
  if (params.password.trim().length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  await readLocalAuthConfig();

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: hashPassword(params.password),
      username: email,
    },
  });
  return getLocalAuthPublicUser(user.id);
}

export async function deleteInvitedLocalUser(userId: string) {
  if (userId === LOCAL_AUTH_SUBJECT) return;
  await prisma.user.deleteMany({ where: { id: userId } });
}
