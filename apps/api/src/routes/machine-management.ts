import { Router, type Request } from 'express';
import { createRequireApiToken } from '../auth/api-token.middleware';
import { prisma } from '../lib/prisma';
import { tokenCanWriteWorkflows } from '../services/api-tokens';
import { deleteWorkflowSchedules } from '../services/schedules';

/** Management keys cannot be workflow-scoped; execution-only keys stay read/run-only. */
export function requireMachineManagement(req: Request) {
  return Boolean(req.apiToken && tokenCanWriteWorkflows(req.apiToken));
}

export function createMachineManagementRouter(
  db = prisma,
  cleanupSchedules = deleteWorkflowSchedules,
) {
  const router = Router();
  router.use(createRequireApiToken());
  router.use((req, res, next) => {
    if (!requireMachineManagement(req)) {
      res.status(403).json({
        error: 'An unrestricted API key with workflow:write is required.',
      });
      return;
    }
    next();
  });

  router.get('/projects', async (req, res) => {
    const raw = req.query.limit;
    const limit = raw === undefined ? 25 : Number(raw);
    if (
      (raw !== undefined && typeof raw !== 'string') ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      res
        .status(400)
        .json({ error: 'limit must be an integer between 1 and 100.' });
      return;
    }
    const projects = await db.project.findMany({
      where: { userId: req.apiToken!.userId },
      select: {
        id: true,
        title: true,
        updatedAt: true,
        _count: { select: { workflows: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
    res.json({
      projects: projects.map(({ _count, ...project }) => ({
        ...project,
        workflowCount: _count.workflows,
      })),
    });
  });

  router.delete('/projects/:projectId', async (req, res) => {
    const result = await db.$transaction(
      async (tx) => {
        const project = await tx.project.findFirst({
          where: { id: req.params.projectId, userId: req.apiToken!.userId },
        });
        if (!project) return { status: 404, error: 'Project not found.' };
        if (await tx.workflow.count({ where: { projectId: project.id } })) {
          return {
            status: 409,
            error: 'Project is not empty. Delete or move its workflows first.',
          };
        }
        await tx.project.delete({ where: { id: project.id } });
        return { status: 204 };
      },
      { isolationLevel: 'Serializable' },
    );
    if (result.error) res.status(result.status).json({ error: result.error });
    else res.status(204).end();
  });

  router.delete('/workflows/:workflowId', async (req, res) => {
    const userId = req.apiToken!.userId;
    const workflowId = req.params.workflowId;
    const workflow = await db.workflow.findFirst({
      where: { id: workflowId, userId },
      select: { id: true },
    });
    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found.' });
      return;
    }
    if (
      await db.workflowExecution.count({
        where: { workflowId, completedAt: null },
      })
    ) {
      res.status(409).json({
        error:
          'Workflow has active executions. Wait for them to finish before deleting it.',
      });
      return;
    }
    // Remove provider schedules first, using the same cleanup path as the editor.
    // If the provider refuses, retain the workflow so the operation can be retried.
    await cleanupSchedules({ req, userId, workflowId });
    const deleted = await db.workflow.deleteMany({
      where: { id: workflowId, userId },
    });
    if (!deleted.count) res.status(404).json({ error: 'Workflow not found.' });
    else res.status(204).end();
  });

  router.use(
    (
      _error: unknown,
      _req: Request,
      res: import('express').Response,
      _next: import('express').NextFunction,
    ) => {
      res.status(500).json({
        error:
          'Management operation failed; refresh the resource before retrying.',
      });
    },
  );
  return router;
}
