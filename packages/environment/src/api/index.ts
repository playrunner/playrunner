import { Router } from 'express';

export const environmentRouter = Router();

export const environmentApiContribution = {
  id: 'environment',
  mountPath: '/api/environment',
  router: environmentRouter,
};
