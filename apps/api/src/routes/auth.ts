import { Router } from 'express';

export const authRouter = Router();

authRouter.get('/me', (req, res) => {
  // Return the verified identity attached to the request
  // We do not fetch roles, teams, or billing here - those are app logic concerns
  res.json({ user: req.authUser });
});
