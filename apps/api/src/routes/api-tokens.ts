import type { Request } from 'express';
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { apiTokens, serializeApiToken } from '../services/api-tokens';

export const apiTokensRouter = Router();

function userIdFor(req: Request) {
  return req.authUser!.providerUserId;
}

apiTokensRouter.get('/', async (req, res) => {
  const tokens = await prisma.apiToken.findMany({
    where: { userId: userIdFor(req) },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ tokens: tokens.map(serializeApiToken) });
});

apiTokensRouter.post('/', async (req, res) => {
  const userId = userIdFor(req);
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const rawAllowedWorkflowIds = req.body?.allowedWorkflowIds;
  if (
    rawAllowedWorkflowIds !== undefined &&
    (!Array.isArray(rawAllowedWorkflowIds) ||
      rawAllowedWorkflowIds.some(
        (id) => typeof id !== 'string' || !id.trim() || id.trim().length > 100,
      ))
  ) {
    res.status(400).json({ error: 'Allowed workflow IDs are invalid.' });
    return;
  }
  const allowedWorkflowIds = [
    ...new Set(
      (rawAllowedWorkflowIds as string[] | undefined)?.map((id) => id.trim()) ??
        [],
    ),
  ];
  const expiresAt = req.body?.expiresAt
    ? new Date(String(req.body.expiresAt))
    : null;
  if (!name || name.length > 100) {
    res.status(400).json({ error: 'Token name must be 1-100 characters.' });
    return;
  }
  if (allowedWorkflowIds.length > 500) {
    res.status(400).json({ error: 'At most 500 workflows may be selected.' });
    return;
  }
  if (
    expiresAt &&
    (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date())
  ) {
    res.status(400).json({ error: 'Expiry must be a future date.' });
    return;
  }
  if (allowedWorkflowIds.length) {
    const count = await prisma.workflow.count({
      where: { id: { in: allowedWorkflowIds }, userId },
    });
    if (count !== allowedWorkflowIds.length) {
      res.status(400).json({ error: 'One or more workflows are invalid.' });
      return;
    }
  }
  const created = await apiTokens.create({
    allowedWorkflowIds,
    expiresAt,
    name,
    userId,
  });
  res.status(201).json({
    plaintext: created.plaintext,
    token: serializeApiToken(created.token),
  });
});

apiTokensRouter.post('/:tokenId/revoke', async (req, res) => {
  const userId = userIdFor(req);
  const result = await prisma.apiToken.updateMany({
    where: { id: req.params.tokenId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (!result.count) {
    res.status(404).json({ error: 'API token not found.' });
    return;
  }
  await prisma.apiTokenAudit.create({
    data: {
      apiTokenId: req.params.tokenId,
      userId,
      action: 'revoked',
    },
  });
  res.status(204).end();
});

apiTokensRouter.post('/:tokenId/rotate', async (req, res) => {
  const rotated = await apiTokens.rotate(req.params.tokenId, userIdFor(req));
  if (!rotated) {
    res.status(404).json({ error: 'API token not found.' });
    return;
  }
  res.status(201).json({
    plaintext: rotated.plaintext,
    token: serializeApiToken(rotated.token),
  });
});
