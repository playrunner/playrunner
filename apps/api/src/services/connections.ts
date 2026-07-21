import { Prisma } from '../generated/prisma/client.cts';
import { prisma } from '../lib/prisma';
import {
  decryptCredentialSecrets,
  encryptCredentialSecrets,
} from './credential-crypto';

export type ConnectionKind = 'cloud' | 'integration';

const SECRET_CONFIG_FIELDS = new Set([
  'accesstoken',
  'apikey',
  'clientid',
  'clientsecret',
  'code',
  'password',
  'refreshtoken',
  'webhookurl',
]);

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error(`${field} must be an object.`), {
      statusCode: 400,
    });
  }
  return value as Record<string, unknown>;
}

export function assertConnectionConfigSafe(
  value: Record<string, unknown>,
  path = 'config',
) {
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (SECRET_CONFIG_FIELDS.has(normalizedKey)) {
      throw Object.assign(
        new Error(`${path}.${key} is a secret and must be stored in secrets.`),
        { statusCode: 400 },
      );
    }
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      assertConnectionConfigSafe(
        child as Record<string, unknown>,
        `${path}.${key}`,
      );
    }
  }
}

function serialize(connection: {
  id: string;
  userId: string;
  kind: string;
  provider: string;
  config: Prisma.JsonValue;
  encryptedSecrets: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: connection.id,
    userId: connection.userId,
    kind: connection.kind,
    provider: connection.provider,
    config: connection.config,
    credentialStatus: {
      configured: Boolean(connection.encryptedSecrets),
    },
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

export async function listPublicConnections(
  userId: string,
  kind: ConnectionKind,
) {
  const connections = await prisma.connection.findMany({
    where: { userId, kind },
  });
  return connections.map(serialize);
}

export async function getPublicConnection(
  userId: string,
  kind: ConnectionKind,
  provider: string,
) {
  const connection = await prisma.connection.findUnique({
    where: { userId_kind_provider: { userId, kind, provider } },
  });
  return connection ? serialize(connection) : null;
}

export async function resolveConnection(
  userId: string,
  kind: ConnectionKind,
  provider: string,
) {
  const connection = await prisma.connection.findUnique({
    where: { userId_kind_provider: { userId, kind, provider } },
  });
  if (!connection) return null;
  const secrets =
    connection.encryptedSecrets && connection.encryptionVersion
      ? decryptCredentialSecrets(
          connection.encryptedSecrets,
          connection.encryptionVersion,
          { userId, kind, provider },
        )
      : {};
  return {
    provider,
    config: objectValue(connection.config, 'Stored connection config'),
    secrets,
  };
}

export async function saveConnection(
  userId: string,
  kind: ConnectionKind,
  provider: string,
  input: unknown,
) {
  const envelope = objectValue(input, 'Connection');
  if (envelope.provider !== undefined && envelope.provider !== provider) {
    throw Object.assign(
      new Error('Connection provider does not match the route.'),
      {
        statusCode: 400,
      },
    );
  }
  const config =
    envelope.config === undefined
      ? undefined
      : objectValue(envelope.config, 'Connection config');
  if (config) assertConnectionConfigSafe(config);
  const secrets =
    envelope.secrets === undefined
      ? undefined
      : objectValue(envelope.secrets, 'Connection secrets');
  if (config === undefined && secrets === undefined) {
    throw Object.assign(
      new Error('Connection must contain config or secrets.'),
      { statusCode: 400 },
    );
  }
  const encrypted =
    secrets === undefined
      ? undefined
      : encryptCredentialSecrets(secrets, { userId, kind, provider });
  const existing = await prisma.connection.findUnique({
    where: { userId_kind_provider: { userId, kind, provider } },
  });
  const connection = await prisma.connection.upsert({
    where: { userId_kind_provider: { userId, kind, provider } },
    create: {
      userId,
      kind,
      provider,
      config: (config ?? {}) as Prisma.InputJsonValue,
      encryptedSecrets: encrypted?.encryptedSecrets,
      encryptionVersion: encrypted?.encryptionVersion,
    },
    update: {
      ...(config === undefined
        ? {}
        : { config: config as Prisma.InputJsonValue }),
      ...(encrypted === undefined ? {} : encrypted),
    },
  });
  if (!existing && secrets === undefined) {
    // A config-only record is valid, but it is deliberately reported unconfigured.
  }
  return serialize(connection);
}

export async function updateConnectionSecrets(
  userId: string,
  kind: ConnectionKind,
  provider: string,
  patch: Record<string, unknown>,
) {
  const current = await resolveConnection(userId, kind, provider);
  if (!current)
    throw new Error(`Connection ${kind}/${provider} was not found.`);
  return saveConnection(userId, kind, provider, {
    secrets: { ...current.secrets, ...patch },
  });
}

export async function deleteConnection(
  userId: string,
  kind: ConnectionKind,
  provider: string,
) {
  await prisma.connection.deleteMany({ where: { userId, kind, provider } });
}

export function createIntegrationCredentialStore(userId: string) {
  return {
    resolve: (kind: ConnectionKind, provider: string) =>
      resolveConnection(userId, kind, provider),
    save: (
      kind: ConnectionKind,
      provider: string,
      envelope: {
        provider?: string;
        config?: Record<string, unknown>;
        secrets?: Record<string, unknown>;
      },
    ) => saveConnection(userId, kind, provider, envelope),
    updateSecrets: (
      kind: ConnectionKind,
      provider: string,
      patch: Record<string, unknown>,
    ) => updateConnectionSecrets(userId, kind, provider, patch),
  };
}
