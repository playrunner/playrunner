import { Router } from 'express';

export const scheduleRouter = Router();

export const scheduleApiContribution = {
  id: 'schedule',
  mountPath: '/api/schedule',
  router: scheduleRouter,
};
