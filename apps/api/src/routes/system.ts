import { Router } from 'express';
import type { Response } from 'express';
import { requireAuth } from '../auth/auth.middleware';
import { state } from '../state';

export const systemRouter = Router();
const presenceClientIds = new WeakMap<Response, string>();

function isResponseAlive(response: Response) {
  return !response.writableEnded && !response.destroyed;
}

systemRouter.get('/presence/stream', requireAuth, (req, res) => {
  let isClosed = false;
  const clientId = `presence-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  presenceClientIds.set(res, clientId);

  const cleanup = (reason: string) => {
    if (isClosed) {
      return;
    }

    isClosed = true;
    clearInterval(heartbeatInterval);
    state.presenceSseClients = state.presenceSseClients.filter(
      (client) => client !== res,
    );
    console.log(
      `[presence] disconnected client=${clientId} reason=${reason} remaining=${state.presenceSseClients.length}`,
    );
  };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(': connected\n\n');
  state.presenceSseClients.push(res);
  console.log(
    `[presence] connected client=${clientId} total=${state.presenceSseClients.length}`,
  );

  const heartbeatInterval = setInterval(() => {
    if (!isResponseAlive(res)) {
      cleanup('response-not-alive');
      return;
    }

    console.log(`[presence] send-heartbeat client=${clientId}`);
    res.write(': heartbeat\n\n');
  }, 15000);

  req.on('close', () => cleanup('request-close'));
  res.on('close', () => cleanup('response-close'));
  res.on('error', () => cleanup('response-error'));
});

systemRouter.get('/heartbeat', (req, res) => {
  state.presenceSseClients = state.presenceSseClients.filter(isResponseAlive);
  const presenceIds = state.presenceSseClients.map(
    (client) => presenceClientIds.get(client) ?? 'unknown',
  );
  console.log(
    `[presence] heartbeat-probe presenceClients=${state.presenceSseClients.length} executionClients=${state.executionSseClients.length} ids=${presenceIds.join(',') || 'none'}`,
  );

  if (state.presenceSseClients.length > 0) {
    res.status(200).send('OK');
  } else {
    res.status(404).send('No editor connected');
  }
});
