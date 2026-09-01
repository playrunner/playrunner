import crypto from 'node:crypto';

export const AUTHENTICATION_ENVELOPE_MAX_BYTES = 7 * 1024 * 1024;
const AUTHENTICATION_ENVELOPE_VERSION = 1;

export type AuthenticationEnvelope = {
  ciphertext: string;
  ephemeralPublicKey: string;
  iv: string;
  salt: string;
  tag: string;
  version: 1;
};

function associatedData(executionId: string, nodeId: string) {
  return Buffer.from(
    `playrunner-authentication-state-v1\0${executionId}\0${nodeId}`,
    'utf8',
  );
}

function deriveKey(sharedSecret: Buffer, salt: Buffer) {
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      sharedSecret,
      salt,
      Buffer.from('playrunner-authentication-envelope-v1', 'utf8'),
      32,
    ),
  );
}

export function createAuthenticationEnvelopeKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
  return {
    privateKey: privateKey
      .export({ format: 'der', type: 'pkcs8' })
      .toString('base64'),
    publicKey: publicKey
      .export({ format: 'der', type: 'spki' })
      .toString('base64'),
  };
}

export function sealAuthenticationEnvelope(args: {
  executionId: string;
  nodeId: string;
  plaintext: Buffer;
  recipientPublicKey: string;
}): AuthenticationEnvelope {
  if (args.plaintext.length > AUTHENTICATION_ENVELOPE_MAX_BYTES) {
    throw new Error('Authentication state exceeds the envelope limit.');
  }
  const recipientPublicKey = crypto.createPublicKey({
    format: 'der',
    key: Buffer.from(args.recipientPublicKey, 'base64'),
    type: 'spki',
  });
  if (recipientPublicKey.asymmetricKeyType !== 'x25519') {
    throw new Error('Authentication envelope public key is invalid.');
  }
  const ephemeral = crypto.generateKeyPairSync('x25519');
  const sharedSecret = crypto.diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: recipientPublicKey,
  });
  const salt = crypto.randomBytes(32);
  const key = deriveKey(sharedSecret, salt);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(associatedData(args.executionId, args.nodeId));
  const ciphertext = Buffer.concat([
    cipher.update(args.plaintext),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString('base64'),
    ephemeralPublicKey: ephemeral.publicKey
      .export({ format: 'der', type: 'spki' })
      .toString('base64'),
    iv: iv.toString('base64'),
    salt: salt.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    version: AUTHENTICATION_ENVELOPE_VERSION,
  };
}

export function openAuthenticationEnvelope(args: {
  envelope: AuthenticationEnvelope;
  executionId: string;
  nodeId: string;
  recipientPrivateKey: string;
}) {
  if (args.envelope.version !== AUTHENTICATION_ENVELOPE_VERSION) {
    throw new Error('Authentication envelope version is unsupported.');
  }
  const privateKey = crypto.createPrivateKey({
    format: 'der',
    key: Buffer.from(args.recipientPrivateKey, 'base64'),
    type: 'pkcs8',
  });
  const publicKey = crypto.createPublicKey({
    format: 'der',
    key: Buffer.from(args.envelope.ephemeralPublicKey, 'base64'),
    type: 'spki',
  });
  if (
    privateKey.asymmetricKeyType !== 'x25519' ||
    publicKey.asymmetricKeyType !== 'x25519'
  ) {
    throw new Error('Authentication envelope key is invalid.');
  }
  const sharedSecret = crypto.diffieHellman({ privateKey, publicKey });
  const key = deriveKey(
    sharedSecret,
    Buffer.from(args.envelope.salt, 'base64'),
  );
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(args.envelope.iv, 'base64'),
  );
  decipher.setAAD(associatedData(args.executionId, args.nodeId));
  decipher.setAuthTag(Buffer.from(args.envelope.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(args.envelope.ciphertext, 'base64')),
    decipher.final(),
  ]);
  if (plaintext.length > AUTHENTICATION_ENVELOPE_MAX_BYTES) {
    throw new Error('Authentication state exceeds the envelope limit.');
  }
  return plaintext;
}
