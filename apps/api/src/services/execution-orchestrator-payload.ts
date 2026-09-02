import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import {
  decryptSecretPayload,
  encryptSecretPayload,
} from './credential-crypto';
import {
  ORCHESTRATOR_BOOTSTRAP_HEADER,
  ORCHESTRATOR_PAYLOAD_MAX_BYTES,
} from '../../../runners/shared/orchestrator-bootstrap';

export { ORCHESTRATOR_BOOTSTRAP_HEADER };
const ORCHESTRATOR_PAYLOAD_TTL_MS = 2 * 60 * 60 * 1000;
const ORCHESTRATOR_PAYLOAD_MAX_FETCHES = 3;

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function assertExecutionId(executionId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(executionId)) {
    throw new Error('Invalid workflow execution ID.');
  }
}

function assertPayload(payload: unknown, executionId: string) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Invalid orchestrator payload.');
  }
  if ((payload as Record<string, unknown>).testId !== executionId) {
    throw new Error('Orchestrator payload execution ID does not match.');
  }
  if (
    Buffer.byteLength(JSON.stringify(payload), 'utf8') >
    ORCHESTRATOR_PAYLOAD_MAX_BYTES
  ) {
    throw new Error('Orchestrator payload exceeds the allowed size.');
  }
}

export async function registerExecutionOrchestratorPayload({
  executionId,
  payload,
}: {
  executionId: string;
  payload: Record<string, unknown>;
}) {
  assertExecutionId(executionId);
  assertPayload(payload, executionId);
  const token = crypto.randomBytes(32).toString('base64url');
  const encrypted = encryptSecretPayload(payload, [
    'orchestrator-execution',
    executionId,
  ]);
  await prisma.executionOrchestratorPayload.upsert({
    where: { executionId },
    create: {
      executionId,
      tokenHash: hashToken(token),
      encryptedPayload: encrypted.encryptedValue,
      encryptionVersion: encrypted.encryptionVersion,
      expiresAt: new Date(Date.now() + ORCHESTRATOR_PAYLOAD_TTL_MS),
    },
    update: {
      tokenHash: hashToken(token),
      encryptedPayload: encrypted.encryptedValue,
      encryptionVersion: encrypted.encryptionVersion,
      expiresAt: new Date(Date.now() + ORCHESTRATOR_PAYLOAD_TTL_MS),
      fetches: 0,
    },
  });
  return token;
}

export async function claimExecutionOrchestratorPayload({
  executionId,
  token,
}: {
  executionId: string;
  token: string;
}) {
  assertExecutionId(executionId);
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) return null;
  const claimed = await prisma.executionOrchestratorPayload.updateMany({
    where: {
      executionId,
      tokenHash: hashToken(token),
      expiresAt: { gt: new Date() },
      fetches: { lt: ORCHESTRATOR_PAYLOAD_MAX_FETCHES },
    },
    data: { fetches: { increment: 1 } },
  });
  if (claimed.count !== 1) return null;
  const stored = await prisma.executionOrchestratorPayload.findFirst({
    where: {
      executionId,
      tokenHash: hashToken(token),
      expiresAt: { gt: new Date() },
    },
  });
  if (!stored) return null;
  const payload = decryptSecretPayload(
    stored.encryptedPayload,
    stored.encryptionVersion,
    ['orchestrator-execution', executionId],
  );
  assertPayload(payload, executionId);
  return payload as Record<string, unknown>;
}

export async function clearExecutionOrchestratorPayload(executionId: string) {
  await prisma.executionOrchestratorPayload
    .delete({ where: { executionId } })
    .catch(() => undefined);
}
