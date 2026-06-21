import { Router } from 'express';
import crypto from 'crypto';
import { ORCHESTRATOR_URL } from '../config';
import { state } from '../state';
import { apiRuntime } from '../runtime';
import { isOrchestratorHealthy } from '../runtime/orchestrator-runner';

export const workflowsRouter = Router();

// Endpoint to start a workflow
workflowsRouter.post('/start', async (req, res) => {
  const testId = crypto.randomUUID();
  req.body.testId = testId;

  const { cloudProvider } = req.body;
  state.testCloudProviders[testId] = cloudProvider || 'LOCAL-DEV';

  console.log(
    `Cloud provider for testId ${testId}: ${state.testCloudProviders[testId]}`,
  );
  const result = await apiRuntime.workflowExecution.execute({
    body: req.body,
    req,
    testId,
  });

  res.status(result.status).json(result.body);
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
