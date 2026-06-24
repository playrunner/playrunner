import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware';
import { apiRuntime } from '../runtime';

export const runnersRouter = Router();

// Endpoint to start the runner (called on mount by Editor.tsx)
runnersRouter.post('/start', requireAuth, async (req, res) => {
  const result = await apiRuntime.runnerProvisioner.start(
    req.body?.cloudProvider,
  );
  res.status(result.status).json(result.body);
});
