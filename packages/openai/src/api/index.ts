import { Router } from 'express';

export const openaiRouter = Router();

export const openaiApiContribution = {
  id: 'openai',
  mountPath: '/api/openai',
  router: openaiRouter,
};

export default openaiApiContribution;
