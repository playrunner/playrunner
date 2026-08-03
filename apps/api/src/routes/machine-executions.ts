import { Router } from 'express';
import { requireApiToken } from '../auth/api-token.middleware';
import { executionEvents } from '../services/execution-events';
import { apiTokens, tokenCanExecuteWorkflow } from '../services/api-tokens';
import { executeSavedWorkflow } from '../services/saved-workflow-execution';

export const machineExecutionsRouter = Router();
machineExecutionsRouter.use(requireApiToken);

function canAccess(
  req: Parameters<typeof requireApiToken>[0],
  workflowId: string,
) {
  return Boolean(
    req.apiToken && tokenCanExecuteWorkflow(req.apiToken, workflowId),
  );
}

machineExecutionsRouter.post('/:workflowId/executions', async (req, res) => {
  const workflowId = req.params.workflowId;
  const token = req.apiToken!;
  if (!canAccess(req, workflowId)) {
    res.status(404).json({ error: 'Workflow not found.' });
    return;
  }
  const started = await executeSavedWorkflow({
    req,
    trigger: { name: 'ci' },
    userId: token.userId,
    workflowId,
  });
  if (!started) {
    res.status(404).json({ error: 'Workflow not found.' });
    return;
  }
  if (started.result.status < 200 || started.result.status >= 300) {
    res.status(started.result.status).json({
      error:
        started.result.status < 500 &&
        typeof started.result.body.error === 'string'
          ? started.result.body.error
          : 'Workflow could not be started.',
    });
    return;
  }
  try {
    await apiTokens.auditExecution({
      apiTokenId: token.id,
      executionId: started.executionId,
      userId: token.userId,
      workflowId,
    });
  } catch (error) {
    console.error('Failed to audit API token execution:', error);
  }
  res.status(202).json({
    executionId: started.executionId,
    status: 'running',
    workflowId,
  });
});

machineExecutionsRouter.get(
  '/:workflowId/executions/:executionId',
  async (req, res) => {
    const token = req.apiToken!;
    const workflowId = req.params.workflowId;
    if (!canAccess(req, workflowId)) {
      res.status(404).json({ error: 'Workflow execution not found.' });
      return;
    }
    const execution = await executionEvents.getExecutionForUser(
      req.params.executionId,
      token.userId,
    );
    if (!execution || execution.workflowId !== workflowId) {
      res.status(404).json({ error: 'Workflow execution not found.' });
      return;
    }
    res.json({
      executionId: execution.id,
      status: execution.status,
      workflowId,
      startedAt: execution.startedAt.toISOString(),
      completedAt: execution.completedAt?.toISOString() ?? null,
    });
  },
);

machineExecutionsRouter.get(
  '/:workflowId/executions/:executionId/events',
  async (req, res) => {
    const token = req.apiToken!;
    const workflowId = req.params.workflowId;
    const execution = await executionEvents.getExecutionForUser(
      req.params.executionId,
      token.userId,
    );
    if (
      !canAccess(req, workflowId) ||
      !execution ||
      execution.workflowId !== workflowId
    ) {
      res.status(404).json({ error: 'Workflow execution not found.' });
      return;
    }
    const after = typeof req.query.after === 'string' ? req.query.after : '0';
    let cursor = 0n;
    try {
      cursor = BigInt(after);
    } catch {
      res.status(400).json({ error: 'Invalid event cursor.' });
      return;
    }
    const events = await executionEvents.listSafeEvents(execution.id, cursor);
    res.json({ events });
  },
);
