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

function aad(parts: readonly string[], version: number) {
  return Buffer.from([...parts, String(version)].join('\0'), 'utf8');
}

export function encryptSecretPayload(
  value: unknown,
  identityParts: readonly string[],
  keyring: CredentialKeyring = loadCredentialKeyring(),
) {
  if (!identityParts.length || identityParts.some((part) => !part)) {
    throw new Error('Credential encryption identity is incomplete.');
  }
  const version = keyring.activeVersion;
  const key = keyring.keys.get(version);
  if (!key) {
    throw new Error(`Credential encryption key version ${version} is missing.`);
  }
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aad(identityParts, version));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    encryptedValue: Buffer.concat([iv, tag, ciphertext]).toString('base64'),
    encryptionVersion: version,
  };
}

export function decryptSecretPayload(
  encryptedValue: string,
  version: number,
  identityParts: readonly string[],
  keyring: CredentialKeyring = loadCredentialKeyring(),
): unknown {
  if (!identityParts.length || identityParts.some((part) => !part)) {
    throw new Error('Credential encryption identity is incomplete.');
  }
  const key = keyring.keys.get(version);
  if (!key) {
    throw new Error(`Credential encryption key version ${version} is missing.`);
  }
  const payload = Buffer.from(encryptedValue, 'base64');
  if (payload.length <= IV_BYTES + 16) {
    throw new Error('Stored credential payload is invalid.');
  }
  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + 16);
  const ciphertext = payload.subarray(IV_BYTES + 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAAD(aad(identityParts, version));
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      'utf8',
    ),
  );
}

export function encryptCredentialSecrets(
  secrets: Record<string, unknown>,
  identity: { userId: string; kind: string; provider: string },
  keyring: CredentialKeyring = loadCredentialKeyring(),
) {
  const encrypted = encryptSecretPayload(
    secrets,
    [identity.userId, identity.kind, identity.provider],
    keyring,
  );
  return {
    encryptedSecrets: encrypted.encryptedValue,
    encryptionVersion: encrypted.encryptionVersion,
  };
}

export function decryptCredentialSecrets(
  encryptedSecrets: string,
  version: number,
  identity: { userId: string; kind: string; provider: string },
  keyring: CredentialKeyring = loadCredentialKeyring(),
): Record<string, unknown> {
  const parsed = decryptSecretPayload(
    encryptedSecrets,
    version,
    [identity.userId, identity.kind, identity.provider],
    keyring,
  );
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Stored credential payload is invalid.');
  }
  return parsed as Record<string, unknown>;
}
