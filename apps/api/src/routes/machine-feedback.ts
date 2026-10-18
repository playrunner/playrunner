import type { Router } from 'express';
import { prisma } from '../lib/prisma';
import { tokenCanExecuteWorkflow } from '../services/api-tokens';
import {
  FEEDBACK_EVENT_TYPES,
  FEEDBACK_PAGE_SIZE,
  FEEDBACK_SNAPSHOT_LIMIT,
  parseFeedbackCursor,
  projectMachineFeedback,
} from '../services/machine-feedback';

// Registered on the existing machine router after requireApiToken.
export function registerMachineFeedbackRoutes(
  router: Router,
  database = prisma,
) {
  router.get(
    '/:workflowId/executions/:executionId/feedback',
    async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      const token = req.apiToken;
      if (!token) return res.status(401).json({ error: 'Unauthorized.' });
      const { workflowId, executionId } = req.params;
      if (!tokenCanExecuteWorkflow(token, workflowId))
        return res.status(404).json({ error: 'Workflow execution not found.' });
      let after: bigint;
      try {
        after = parseFeedbackCursor(req.query.after);
      } catch (error) {
        return res.status(400).json({ error: (error as Error).message });
      }
      try {
        // Do not use current team membership or a reservation as a substitute for
        // the machine API's execution-owner and workflow restrictions.
        const execution = await database.workflowExecution.findFirst({
          where: { id: executionId, workflowId, userId: token.userId },
          select: {
            id: true,
            workflowId: true,
            status: true,
            cloudProvider: true,
            startedAt: true,
            completedAt: true,
          },
        });
        if (!execution)
          return res
            .status(404)
            .json({ error: 'Workflow execution not found.' });
        const latest = await database.workflowEvent.findFirst({
          where: { executionId },
          orderBy: { id: 'desc' },
          select: { id: true, createdAt: true },
        });
        const through = latest?.id ?? 0n;
        const select = {
          id: true,
          type: true,
          nodeId: true,
          payload: true,
          createdAt: true,
          occurredAt: true,
        } as const;
        const [definition, snapshot, page] = await Promise.all([
          database.workflowEvent.findFirst({
            where: { executionId, type: 'execution_definition' },
            orderBy: { id: 'asc' },
            select,
          }),
          database.workflowEvent.findMany({
            where: {
              executionId,
              id: { lte: through },
              type: { in: FEEDBACK_EVENT_TYPES },
            },
            orderBy: { id: 'desc' },
            take: FEEDBACK_SNAPSHOT_LIMIT + 1,
            select,
          }),
          database.workflowEvent.findMany({
            where: {
              executionId,
              id: { gt: after, lte: through },
              type: { in: FEEDBACK_EVENT_TYPES },
            },
            orderBy: { id: 'asc' },
            take: FEEDBACK_PAGE_SIZE + 1,
            select,
          }),
        ]);
        return res.json(
          projectMachineFeedback({
            execution: { ...execution, lastEventAt: latest?.createdAt },
            snapshotEvents: [
              ...(definition ? [definition] : []),
              ...snapshot.slice(0, FEEDBACK_SNAPSHOT_LIMIT),
            ],
            snapshotTruncated: snapshot.length > FEEDBACK_SNAPSHOT_LIMIT,
            pageEvents: page,
            after,
          }),
        );
      } catch {
        return res
          .status(503)
          .json({ error: 'Execution feedback is unavailable.' });
      }
    },
  );
}
