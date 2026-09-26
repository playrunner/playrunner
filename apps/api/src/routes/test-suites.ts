import { Router, raw, type ErrorRequestHandler } from 'express';
import { createHash } from 'node:crypto';
import { requireAuth } from '../auth/auth.middleware';
import { prisma } from '../lib/prisma';
import {
  executionEvents,
  EXECUTION_TOKEN_HEADER,
} from '../services/execution-events';

export const testSuitesRouter = Router();

testSuitesRouter.post(
  '/',
  requireAuth,
  raw({ type: 'application/zip', limit: '50mb' }),
  async (req, res) => {
    const contents = req.body;
    const name = typeof req.query.name === 'string' ? req.query.name : '';
    if (
      !Buffer.isBuffer(contents) ||
      contents.length < 4 ||
      contents.readUInt32LE(0) !== 0x04034b50 ||
      !/^[^/\\]{1,200}\.zip$/i.test(name) ||
      name.includes(String.fromCharCode(0))
    ) {
      res.status(400).json({
        error: 'Upload a non-empty ZIP test suite with a .zip filename.',
      });
      return;
    }
    const suite = await prisma.testSuiteUpload.create({
      data: {
        userId: req.authUser!.providerUserId,
        name,
        sha256: createHash('sha256').update(contents).digest('hex'),
        contents,
      },
      select: { id: true, name: true, sha256: true },
    });
    res.status(201).json(suite);
  },
);

// Runners may only download a suite included in their immutable execution snapshot.
testSuitesRouter.get('/:id/execution/:executionId', async (req, res) => {
  const token = req.header(EXECUTION_TOKEN_HEADER);
  const execution =
    token &&
    (await executionEvents.verifyExecutionToken(req.params.executionId, token));
  if (!execution) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const definition = await prisma.workflowEvent.findFirst({
    where: { executionId: execution.id, type: 'execution_definition' },
    select: { payload: true },
  });
  const nodes =
    (definition?.payload as { nodes?: Array<{ suiteId?: string }> } | undefined)
      ?.nodes ?? [];
  if (!nodes.some((node) => node.suiteId === req.params.id)) {
    res.status(404).end();
    return;
  }
  const suite = await prisma.testSuiteUpload.findUnique({
    where: { id: req.params.id },
  });
  if (!suite) {
    res.status(404).end();
    return;
  }
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(Buffer.from(suite.contents));
});

const uploadError: ErrorRequestHandler = (error, _req, res, next) => {
  if (error?.type === 'entity.too.large') {
    res
      .status(413)
      .json({ error: 'Test suite exceeds the 50 MB upload limit.' });
    return;
  }
  next(error);
};
testSuitesRouter.use(uploadError);
