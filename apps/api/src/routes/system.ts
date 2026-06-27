import { Router } from 'express';
import type { Response } from 'express';
import { requireAuth } from '../auth/auth.middleware';
import { state } from '../state';

export const systemRouter = Router();

function isResponseAlive(response: Response) {
  return !response.writableEnded && !response.destroyed;
}

systemRouter.get('/presence/stream', requireAuth, (req, res) => {
  let isClosed = false;

  const cleanup = () => {
    if (isClosed) {
      return;
    }

    isClosed = true;
    clearInterval(heartbeatInterval);
    state.presenceSseClients = state.presenceSseClients.filter(
      (client) => client !== res,
    );
  };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(': connected\n\n');
  state.presenceSseClients.push(res);

  const heartbeatInterval = setInterval(() => {
    if (!isResponseAlive(res)) {
      cleanup();
      return;
    }

    res.write(': heartbeat\n\n');
  }, 15000);

  req.on('close', () => cleanup());
  res.on('close', () => cleanup());
  res.on('error', () => cleanup());
});

systemRouter.get('/heartbeat', (req, res) => {
  state.presenceSseClients = state.presenceSseClients.filter(isResponseAlive);

  if (state.presenceSseClients.length > 0) {
    res.status(200).send('OK');
  } else {
    res.status(404).send('No editor connected');
  }
});
