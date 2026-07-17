import { Router } from 'express';

export const javascriptRouter = Router();

export const javascriptApiContribution = {
  id: 'code',
  mountPath: '/api/javascript',
  router: javascriptRouter,
};

export default javascriptApiContribution;
