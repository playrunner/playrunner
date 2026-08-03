import crypto from 'crypto';
import type { Prisma } from '../generated/prisma/client.cts';
import { prisma } from '../lib/prisma';

export const API_TOKEN_PREFIX = 'pr_live_';
export const WORKFLOW_EXECUTE_SCOPE = 'workflow:execute';
const TOKEN_BYTES = 32;

type TokenRecord = {
  allowedWorkflowIds: unknown;
  expiresAt: Date | null;
  revokedAt: Date | null;
  scopes: unknown;
  tokenHash: string;
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export function hashApiToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function apiTokenHashesMatch(token: string, expectedHash: string) {
  const received = Buffer.from(hashApiToken(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return (
    received.length === expected.length &&
    crypto.timingSafeEqual(received, expected)
  );
}

export function generateApiToken() {
  return `${API_TOKEN_PREFIX}${crypto.randomBytes(TOKEN_BYTES).toString('base64url')}`;
}

export function tokenCanExecuteWorkflow(
  token: Pick<TokenRecord, 'allowedWorkflowIds' | 'scopes'>,
  workflowId: string,
) {
  const scopes = stringArray(token.scopes);
  if (!scopes.includes(WORKFLOW_EXECUTE_SCOPE)) return false;
  const allowedWorkflowIds = stringArray(token.allowedWorkflowIds);
  return (
    allowedWorkflowIds.length === 0 || allowedWorkflowIds.includes(workflowId)
  );
}

export function tokenIsActive(
  token: Pick<TokenRecord, 'expiresAt' | 'revokedAt'>,
) {
  return !token.revokedAt && (!token.expiresAt || token.expiresAt > new Date());
}

function jsonStringArray(value: string[]): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export const apiTokens = {
  async authenticate(plaintext: string) {
    if (!plaintext.startsWith(API_TOKEN_PREFIX)) return null;
    const token = await prisma.apiToken.findUnique({
      where: { tokenHash: hashApiToken(plaintext) },
    });
    if (
      !token ||
      !apiTokenHashesMatch(plaintext, token.tokenHash) ||
      !tokenIsActive(token)
    ) {
      return null;
    }
    if (!token.lastUsedAt || token.lastUsedAt < new Date(Date.now() - 60_000)) {
      await prisma.apiToken.update({
        where: { id: token.id },
        data: { lastUsedAt: new Date() },
      });
    }
    return token;
  },

  async create(params: {
    allowedWorkflowIds?: string[];
    expiresAt?: Date | null;
    name: string;
    userId: string;
  }) {
    const plaintext = generateApiToken();
    const token = await prisma.apiToken.create({
      data: {
        userId: params.userId,
        name: params.name,
        tokenHash: hashApiToken(plaintext),
        displayPrefix: plaintext.slice(0, API_TOKEN_PREFIX.length + 8),
        scopes: jsonStringArray([WORKFLOW_EXECUTE_SCOPE]),
        allowedWorkflowIds: params.allowedWorkflowIds?.length
          ? jsonStringArray(params.allowedWorkflowIds)
          : undefined,
        expiresAt: params.expiresAt ?? null,
        auditEvents: {
          create: { action: 'created', userId: params.userId },
        },
      },
    });
    return { plaintext, token };
  },

  async rotate(tokenId: string, userId: string) {
    const existing = await prisma.apiToken.findFirst({
      where: { id: tokenId, userId, revokedAt: null },
    });
    if (!existing) return null;

    const plaintext = generateApiToken();
    const token = await prisma.$transaction(async (transaction) => {
      const revoked = await transaction.apiToken.updateMany({
        where: { id: existing.id, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (!revoked.count) return null;
      await transaction.apiTokenAudit.create({
        data: { action: 'rotated', apiTokenId: existing.id, userId },
      });
      return transaction.apiToken.create({
        data: {
          userId,
          name: existing.name,
          tokenHash: hashApiToken(plaintext),
          displayPrefix: plaintext.slice(0, API_TOKEN_PREFIX.length + 8),
          scopes: jsonStringArray([WORKFLOW_EXECUTE_SCOPE]),
          allowedWorkflowIds: stringArray(existing.allowedWorkflowIds).length
            ? jsonStringArray(stringArray(existing.allowedWorkflowIds))
            : undefined,
          expiresAt:
            existing.expiresAt && existing.expiresAt > new Date()
              ? existing.expiresAt
              : null,
          auditEvents: { create: { action: 'created', userId } },
        },
      });
    });
    if (!token) return null;
    return { plaintext, token };
  },

  async auditExecution(params: {
    apiTokenId: string;
    executionId: string;
    userId: string;
    workflowId: string;
  }) {
    await prisma.apiTokenAudit.create({
      data: { ...params, action: 'execution_started' },
    });
  },
};

export function serializeApiToken(token: {
  allowedWorkflowIds: unknown;
  createdAt: Date;
  displayPrefix: string;
  expiresAt: Date | null;
  id: string;
  lastUsedAt: Date | null;
  name: string;
  revokedAt: Date | null;
  scopes: unknown;
}) {
  return {
    id: token.id,
    name: token.name,
    displayPrefix: token.displayPrefix,
    scopes: stringArray(token.scopes),
    allowedWorkflowIds: stringArray(token.allowedWorkflowIds),
    createdAt: token.createdAt.toISOString(),
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    expiresAt: token.expiresAt?.toISOString() ?? null,
    revokedAt: token.revokedAt?.toISOString() ?? null,
  };
}
