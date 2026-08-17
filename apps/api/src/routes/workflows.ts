import { Router } from 'express';
import crypto from 'crypto';
import { ORCHESTRATOR_URL } from '../config';
import { state } from '../state';
import { apiRuntime } from '../runtime';
import { isOrchestratorHealthy } from '../runtime/orchestrator-runner';
import { requireAccessibleWorkflow } from '../services/workflow-access';

export const workflowsRouter = Router();

// Endpoint to start a workflow
workflowsRouter.post('/start', async (req, res) => {
  try {
    const actorUserId = req.authUser!.providerUserId;
    const testId = crypto.randomUUID();
    const workflowId =
      typeof req.body?.workflowId === 'string' ? req.body.workflowId : '';
    let body = { ...req.body, testId };
    let resourceOwnerUserId = actorUserId;

    if (workflowId && workflowId !== 'current') {
      const workflow = await requireAccessibleWorkflow(actorUserId, workflowId);
      resourceOwnerUserId = workflow.userId;
      if (workflow.userId !== actorUserId) {
        const cloudProvider = workflow.cloudProvider || 'LOCAL_RUNNER';
        body = {
          ...body,
          cloudProvider,
          concurrency: workflow.concurrency ?? undefined,
          connections: workflow.connections ?? [],
          nodes: workflow.nodes ?? [],
          workflow: {
            definition: {
              id: workflow.id,
              name: workflow.title || 'Untitled Workflow',
            },
            run: {
              runner: cloudProvider,
              trigger: 'manual',
            },
          },
        };
      }
    }

    state.testCloudProviders[testId] = body.cloudProvider || 'LOCAL_RUNNER';
    console.log(
      `Cloud provider for testId ${testId}: ${state.testCloudProviders[testId]}`,
    );
    const result = await apiRuntime.workflowExecution.execute({
      body,
      req,
      resourceOwnerUserId,
      testId,
    });

    res.status(result.status).json(result.body);
  } catch (error) {
    const status =
      typeof (error as { statusCode?: unknown })?.statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
    res.status(status).json({
      code:
        typeof (error as { code?: unknown })?.code === 'string'
          ? (error as { code: string }).code
          : undefined,
      error:
        error instanceof Error
          ? error.message
          : 'The workflow could not be started.',
    });
  }
});

// Endpoint to stop a node
workflowsRouter.post('/stop-node', async (req, res) => {
  if (!(await isOrchestratorHealthy())) {
    return res.status(400).json({ error: 'Runner is not running.' });
  }

  try {
    const response = await fetch(`${ORCHESTRATOR_URL}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });

    if (response.ok) {
      res.status(200).json({ message: 'Node stop requested' });
    } else {
      res.status(500).json({ error: 'Runner failed to stop node' });
    }
  } catch (err: any) {
    res
      .status(500)
      .json({ error: `Failed to communicate with runner: ${err.message}` });
  }
});
