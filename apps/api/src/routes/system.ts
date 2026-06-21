import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware';
import { state } from '../state';

export const systemRouter = Router();

systemRouter.get('/presence/stream', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  res.write(': connected\n\n');
  state.sseClients.push(res);
  console.log(`Editor presence SSE connected. Total clients: ${state.sseClients.length}`);

  const heartbeatInterval = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeatInterval);
    state.sseClients = state.sseClients.filter(client => client !== res);
    console.log(`Editor presence SSE disconnected. Total clients: ${state.sseClients.length}`);
  });
});

systemRouter.get('/heartbeat', (req, res) => {
  if (state.sseClients.length > 0) {
    res.status(200).send('OK');
  } else {
    res.status(404).send('No editor connected');
  }
});
