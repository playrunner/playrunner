import { prisma } from '../lib/prisma';
import { accessibleWorkflowWhere } from '../services/workflow-access';
import {
  inspectLocalExecution,
  stopLocalExecution,
} from '../services/execution-control';
import { getWorkflowPlanReport } from '../services/workflow-test-plan';
import { Router } from 'express';
import { getRunnerResources } from '../services/runner-resources';
import { listDashboardExecutions } from '../services/execution-dashboard';
import { requireAuth } from '../auth/auth.middleware';
import { executionEvents } from '../services/execution-events';
import { state } from '../state';

export const executionsRouter = Router();

function recentPagination(query: Record<string, unknown>) {
  const requestedPage = typeof query.page === 'string' ? Number(query.page) : 1;
  const page =
    Number.isSafeInteger(requestedPage) &&
    requestedPage > 0 &&
    requestedPage <= 1_000_000
      ? requestedPage
      : 1;
  const requestedSize =
    typeof query.pageSize === 'string' ? Number(query.pageSize) : 10;
  return {
    page,
    pageSize: [10, 25, 50].includes(requestedSize) ? requestedSize : 10,
  };
}

// Complete, authorized snapshots make initial load and reconnection identical.
executionsRouter.get('/live', requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const { page, pageSize } = recentPagination(req.query);
    const { executions, recent } = await listDashboardExecutions(
      req.authUser!.providerUserId,
      page,
      pageSize,
    );
    const resources = await getRunnerResources(
      new Set(executions.map((execution) => execution.id)),
    );
    res.json({ executions, resources, recent });
  } catch {
    res.status(503).json({ error: 'Execution service unavailable.' });
  }
});

executionsRouter.get('/live/stream', requireAuth, (req, res) => {
  let closed = false;
  let polling = false;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const flush = async () => {
    if (closed || polling) return;
    polling = true;
    try {
      // Recheck team membership on every snapshot, including after access revocation.
      const { page, pageSize } = recentPagination(req.query);
      const { executions, recent } = await listDashboardExecutions(
        req.authUser!.providerUserId,
        page,
        pageSize,
      );
      const resources = await getRunnerResources(
        new Set(executions.map((execution) => execution.id)),
      );
      if (!closed)
        res.write(
          `data: ${JSON.stringify({ executions, resources, recent })}\n\n`,
        );
    } catch {
      if (!closed) res.end();
    } finally {
      polling = false;
    }
  };
  const interval = setInterval(() => {
    void flush();
  }, 1000);
  const cleanup = () => {
    closed = true;
    clearInterval(interval);
  };
  res.on('close', cleanup);
  res.on('error', cleanup);
  void flush();
});

executionsRouter.get(
  '/:executionId/test-plan',
  requireAuth,
  async (req, res) => {
    try {
      const report = await getWorkflowPlanReport(
        req.params.executionId,
        req.authUser!.providerUserId,
      );
      res.setHeader('Cache-Control', 'private, no-store');
      if (!report) {
        res.status(404).json({
          error: 'No workflow test plan was captured for this execution.',
        });
        return;
      }
      res.json(report);
    } catch {
      res
        .status(500)
        .json({ error: 'Could not load the workflow test plan report.' });
    }
  },
);

// Resolve authorization from durable records, including team membership. Never
// use the browser's provider, node IDs, or an API process's in-memory run map.
for (const action of ['check', 'stop'] as const) {
  executionsRouter.post(
    '/:executionId/' + action,
    requireAuth,
    async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      try {
        const userId = req.authUser!.providerUserId;
        const execution = await prisma.workflowExecution.findFirst({
          where: {
            id: req.params.executionId,
          },
        });
        const accessible =
          execution &&
          (execution.userId === userId ||
            (execution.workflowId &&
              (await prisma.workflow.findFirst({
                where: {
                  id: execution.workflowId,
                  ...accessibleWorkflowWhere(userId),
                },
                select: { id: true },
              }))));
        if (!execution || !accessible)
          return res
            .status(404)
            .json({ error: 'Workflow execution not found.' });
        if (execution.status !== 'running')
          return res.json({
            state: 'finished',
            status: execution.status,
            checkedAt: new Date().toISOString(),
          });
        if (execution.cloudProvider !== 'LOCAL_RUNNER')
          return res.status(409).json({
            error:
              'Live checks and stop controls are currently available for local runs only.',
          });
        const result =
          action === 'stop'
            ? await stopLocalExecution(execution.id)
            : await inspectLocalExecution(execution.id);
        if (action === 'stop' && result.state === 'inactive') {
          // A stale run has no orchestrator work or containers left. Close it only
          // on explicit stop, without overwriting a concurrently received outcome.
          await prisma.$transaction(async (tx) => {
            const updated = await tx.workflowExecution.updateMany({
              where: { id: execution.id, status: 'running' },
              data: { status: 'cancelled', completedAt: new Date() },
            });
            if (updated.count)
              await tx.workflowEvent.create({
                data: {
                  executionId: execution.id,
                  userId: execution.userId,
                  workflowId: execution.workflowId,
                  type: 'workflow_cancelled',
                  payload: {
                    type: 'workflow_cancelled',
                    message: 'Stopped by user; no active local runners remain.',
                  },
                },
              });
          });
          return res.json({
            ...result,
            state: 'finished',
            status: await executionEvents.getExecutionStatus(execution.id),
          });
        }
        return res.json(result);
      } catch {
        return res.status(503).json({
          error:
            action === 'stop'
              ? 'Could not confirm the run has stopped. Check the local orchestrator and Docker, then retry. Check activity before retrying.'
              : 'Could not check this run. Check the local orchestrator and Docker, then retry.',
        });
      }
    },
  );
}

function getStringHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseSequenceCursor(value: string | undefined) {
  if (!value) {
    return 0n;
  }

  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : 0n;
  } catch {
    return 0n;
  }
}

executionsRouter.get('/:executionId/stream', requireAuth, async (req, res) => {
  const executionId = req.params.executionId;
  const userId = req.authUser?.providerUserId;

  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const execution = await executionEvents.getExecutionForUser(
    executionId,
    userId,
  );
  if (!execution) {
    res.status(404).json({ error: 'Workflow execution not found.' });
    return;
  }

  let isClosed = false;
  let isPolling = false;
  let cursor = parseSequenceCursor(
    getStringHeader(req.headers['last-event-id']),
  );

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write(': connected\n\n');

  state.executionSseClients.push(res);
  console.log(
    `Execution SSE connected for ${executionId}. Total clients: ${state.executionSseClients.length}`,
  );

  const flushEvents = async () => {
    if (isClosed || isPolling) {
      return;
    }

    isPolling = true;

    try {
      while (!isClosed) {
        const events = await executionEvents.listEvents(executionId, cursor);
        if (events.length === 0) {
          break;
        }

        for (const event of events) {
          cursor = event.sequence;
          res.write(`id: ${event.sequence.toString()}\n`);
          res.write(`data: ${JSON.stringify(event.payload)}\n\n`);
        }

        if (events.length < 100) {
          break;
        }
      }
    } catch (error) {
      console.error(`Execution SSE polling failed for ${executionId}:`, error);
      if (!isClosed) {
        res.end();
      }
    } finally {
      isPolling = false;
    }
  };

  void flushEvents();

  const pollInterval = setInterval(() => {
    void flushEvents();
  }, 750);
  const heartbeatInterval = setInterval(() => {
    if (!isClosed) {
      res.write(': heartbeat\n\n');
    }
  }, 15000);

  const cleanup = () => {
    if (isClosed) {
      return;
    }

    isClosed = true;
    clearInterval(pollInterval);
    clearInterval(heartbeatInterval);
    state.executionSseClients = state.executionSseClients.filter(
      (client) => client !== res,
    );
    console.log(
      `Execution SSE disconnected for ${executionId}. Total clients: ${state.executionSseClients.length}`,
    );
  };

  req.on('close', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
});
