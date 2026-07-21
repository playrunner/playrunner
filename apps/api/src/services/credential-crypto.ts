import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

export interface CredentialKeyring {
  activeVersion: number;
  keys: ReadonlyMap<number, Buffer>;
}

export function loadCredentialKeyring(
  env: NodeJS.ProcessEnv = process.env,
): CredentialKeyring {
  const activeVersion = Number(
    env.PLAYRUNNER_CREDENTIAL_ENCRYPTION_KEY_VERSION,
  );
  if (!Number.isInteger(activeVersion) || activeVersion < 1) {
    throw new Error(
      'PLAYRUNNER_CREDENTIAL_ENCRYPTION_KEY_VERSION must be a positive integer.',
    );
  }

  let configured: unknown;
  try {
    configured = JSON.parse(env.PLAYRUNNER_CREDENTIAL_ENCRYPTION_KEYS ?? '');
  } catch {
    throw new Error(
      'PLAYRUNNER_CREDENTIAL_ENCRYPTION_KEYS must be a JSON object of base64-encoded 32-byte keys.',
    );
  }
  if (
    !configured ||
    typeof configured !== 'object' ||
    Array.isArray(configured)
  ) {
    throw new Error(
      'PLAYRUNNER_CREDENTIAL_ENCRYPTION_KEYS must be a JSON object.',
    );
  }

  const keys = new Map<number, Buffer>();
  for (const [versionText, encodedKey] of Object.entries(configured)) {
    const version = Number(versionText);
    if (!Number.isInteger(version) || typeof encodedKey !== 'string') {
      throw new Error('Credential encryption key versions must be integers.');
    }
    const key = Buffer.from(encodedKey, 'base64');
    if (key.length !== 32 || key.toString('base64') !== encodedKey) {
      throw new Error(
        `Credential encryption key version ${version} must be exactly 32 bytes encoded as base64.`,
      );
    }
    keys.set(version, key);
  }
  if (!keys.has(activeVersion)) {
    throw new Error(
      `Credential encryption key version ${activeVersion} is not configured.`,
    );
  }
  return { activeVersion, keys };
}

function aad(userId: string, kind: string, provider: string, version: number) {
  return Buffer.from(`${userId}\0${kind}\0${provider}\0${version}`, 'utf8');
}

export function encryptCredentialSecrets(
  secrets: Record<string, unknown>,
  identity: { userId: string; kind: string; provider: string },
  keyring: CredentialKeyring = loadCredentialKeyring(),
) {
  const version = keyring.activeVersion;
  const key = keyring.keys.get(version);
  if (!key) {
    throw new Error(`Credential encryption key version ${version} is missing.`);
  }
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(
    aad(identity.userId, identity.kind, identity.provider, version),
  );
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(secrets), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    encryptedSecrets: Buffer.concat([iv, tag, ciphertext]).toString('base64'),
    encryptionVersion: version,
  };
}

export function decryptCredentialSecrets(
  encryptedSecrets: string,
  version: number,
  identity: { userId: string; kind: string; provider: string },
  keyring: CredentialKeyring = loadCredentialKeyring(),
): Record<string, unknown> {
  const key = keyring.keys.get(version);
  if (!key) {
    throw new Error(`Credential encryption key version ${version} is missing.`);
  }
  const payload = Buffer.from(encryptedSecrets, 'base64');
  if (payload.length <= IV_BYTES + 16) {
    throw new Error('Stored credential payload is invalid.');
  }
  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + 16);
  const ciphertext = payload.subarray(IV_BYTES + 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAAD(
    aad(identity.userId, identity.kind, identity.provider, version),
  );
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');
  const parsed: unknown = JSON.parse(plaintext);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Stored credential payload is invalid.');
  }
  return parsed as Record<string, unknown>;
}
