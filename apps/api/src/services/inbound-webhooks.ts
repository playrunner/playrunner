import crypto from 'crypto';
import type {
  InboundWebhookRequest,
  IntegrationApiHost,
} from '@playrunner/integration-sdk/api';
import type { Request } from 'express';
import { prisma } from '../lib/prisma';
import { apiRuntime } from '../runtime';
import { state } from '../state';
import {
  decryptCredentialSecrets,
  encryptCredentialSecrets,
} from './credential-crypto';
import { tunnelService } from './tunnel';

const SECRET_BYTES = 32;

function hashSecret(secret: string) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function secretsMatch(secret: string, expectedHash: string) {
  const received = Buffer.from(hashSecret(secret), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return (
    received.length === expected.length &&
    crypto.timingSafeEqual(received, expected)
  );
}

function endpointIdentity(userId: string, endpointId: string) {
  return { userId, kind: 'webhook-endpoint', provider: endpointId };
}

function revealSecret(endpoint: {
  encryptedSecret: string;
  encryptionVersion: number;
  id: string;
  userId: string;
}) {
  const secrets = decryptCredentialSecrets(
    endpoint.encryptedSecret,
    endpoint.encryptionVersion,
    endpointIdentity(endpoint.userId, endpoint.id),
  );
  if (typeof secrets.secret !== 'string') {
    throw new Error('Stored webhook endpoint secret is invalid.');
  }
  return secrets.secret;
}

function endpointResult(endpoint: {
  enabled: boolean;
  encryptedSecret: string;
  encryptionVersion: number;
  id: string;
  userId: string;
}) {
  const secret = revealSecret(endpoint);
  return {
    enabled: endpoint.enabled,
    endpointId: endpoint.id,
    path: `/api/webhooks/inbound/${endpoint.id}/${secret}`,
    secret,
  };
}

function executionRequest(baseUrl: string, userId: string): Request {
  const url = new URL(baseUrl);
  return {
    authUser: { provider: 'webhook', providerUserId: userId },
    get(name: string) {
      return name.toLowerCase() === 'host' ? url.host : undefined;
    },
    protocol: url.protocol.replace(':', ''),
  } as Request;
}

function workflowHasNode(nodes: unknown, nodeId: string) {
  return (
    Array.isArray(nodes) &&
    nodes.some(
      (node) =>
        node &&
        typeof node === 'object' &&
        'id' in node &&
        node.id === nodeId &&
        'nodeType' in node &&
        node.nodeType === 'webhooks',
    )
  );
}

export const inboundWebhookHost: IntegrationApiHost['inboundWebhooks'] = {
  async createOrRotateEndpoint({ enabled, nodeId, userId, workflowId }) {
    const workflow = await prisma.workflow.findFirst({
      where: { id: workflowId, userId },
      select: { id: true, nodes: true },
    });
    if (!workflow) throw new Error('Workflow was not found.');
    if (!workflowHasNode(workflow.nodes, nodeId)) {
      throw Object.assign(
        new Error('Save the Webhooks node before creating its endpoint.'),
        { statusCode: 409 },
      );
    }

    const id = crypto.randomUUID();
    const secret = crypto.randomBytes(SECRET_BYTES).toString('base64url');
    const encrypted = encryptCredentialSecrets(
      { secret },
      endpointIdentity(userId, id),
    );
    const endpoint = await prisma.workflowWebhookEndpoint.upsert({
      where: { workflowId_nodeId: { workflowId, nodeId } },
      create: {
        id,
        userId,
        workflowId,
        nodeId,
        enabled,
        secretHash: hashSecret(secret),
        encryptedSecret: encrypted.encryptedSecrets,
        encryptionVersion: encrypted.encryptionVersion,
      },
      update: {
        id,
        enabled,
        secretHash: hashSecret(secret),
        encryptedSecret: encrypted.encryptedSecrets,
        encryptionVersion: encrypted.encryptionVersion,
      },
    });
    return endpointResult(endpoint);
  },

  async dispatch(endpointId, secret, inboundRequest) {
    const endpoint = await prisma.workflowWebhookEndpoint.findUnique({
      where: { id: endpointId },
      include: { workflow: true },
    });
    if (
      !endpoint ||
      !endpoint.enabled ||
      !workflowHasNode(endpoint.workflow.nodes, endpoint.nodeId) ||
      !secretsMatch(secret, endpoint.secretHash)
    ) {
      return null;
    }

    const executionId = crypto.randomUUID();
    const cloudProvider =
      endpoint.workflow.cloudProvider === 'GCP' ? 'GCP' : 'LOCAL_RUNNER';
    state.testCloudProviders[executionId] = cloudProvider;
    const receivedAt = new Date().toISOString();
    const trigger = {
      webhook: sanitizeRequest(inboundRequest, receivedAt),
    };
    const result = await apiRuntime.workflowExecution.execute({
      body: {
        cloudProvider,
        concurrency: endpoint.workflow.concurrency ?? undefined,
        connections: endpoint.workflow.connections ?? [],
        nodes: endpoint.workflow.nodes ?? [],
        trigger,
        workflowId: endpoint.workflowId,
        workflow: {
          definition: {
            id: endpoint.workflowId,
            name: endpoint.workflow.title || 'Untitled Workflow',
          },
          run: { runner: cloudProvider, trigger: 'webhook' },
          trigger,
        },
      },
      req: executionRequest('http://localhost:3011', endpoint.userId),
      testId: executionId,
    });
    if (result.status < 200 || result.status >= 300) {
      throw new Error('Workflow could not be started.');
    }
    return { executionId, status: 'started' };
  },

  async getEndpoint({ nodeId, userId, workflowId }) {
    const endpoint = await prisma.workflowWebhookEndpoint.findFirst({
      where: { nodeId, userId, workflowId },
    });
    return endpoint ? endpointResult(endpoint) : null;
  },

  async setEnabled({ enabled, nodeId, userId, workflowId }) {
    await prisma.workflowWebhookEndpoint.updateMany({
      where: { nodeId, userId, workflowId },
      data: { enabled },
    });
  },
};

function sanitizeRequest(request: InboundWebhookRequest, receivedAt: string) {
  const headers = Object.fromEntries(
    Object.entries(request.headers).filter(([name]) =>
      ['content-type', 'user-agent', 'x-request-id'].includes(
        name.toLowerCase(),
      ),
    ),
  );
  return {
    body: request.body,
    headers,
    method: request.method,
    query: request.query,
    receivedAt,
  };
}

export function createIntegrationApiHost(): IntegrationApiHost {
  return { inboundWebhooks: inboundWebhookHost, tunnel: tunnelService };
}
