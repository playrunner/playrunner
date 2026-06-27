import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware';
import { executionEvents } from '../services/execution-events';
import { state } from '../state';

export const executionsRouter = Router();

function getStringHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseSequenceCursor(value: string | undefined) {
  if (!value) {
    return 0n;
  }

  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : 0n;
  } catch {
    return 0n;
  }
}

executionsRouter.get('/:executionId/stream', requireAuth, async (req, res) => {
  const executionId = req.params.executionId;
  const userId = req.authUser?.providerUserId;

  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const execution = await executionEvents.getExecutionForUser(
    executionId,
    userId,
  );
  if (!execution) {
    res.status(404).json({ error: 'Workflow execution not found.' });
    return;
  }

  let isClosed = false;
  let isPolling = false;
  let cursor = parseSequenceCursor(
    getStringHeader(req.headers['last-event-id']),
  );

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write(': connected\n\n');

  state.executionSseClients.push(res);
  console.log(
    `Execution SSE connected for ${executionId}. Total clients: ${state.executionSseClients.length}`,
  );

  const flushEvents = async () => {
    if (isClosed || isPolling) {
      return;
    }

    isPolling = true;

    try {
      while (!isClosed) {
        const events = await executionEvents.listEvents(executionId, cursor);
        if (events.length === 0) {
          break;
        }

        for (const event of events) {
          cursor = event.sequence;
          res.write(`id: ${event.sequence.toString()}\n`);
          res.write(`data: ${JSON.stringify(event.payload)}\n\n`);
        }

        if (events.length < 100) {
          break;
        }
      }
    } catch (error) {
      console.error(`Execution SSE polling failed for ${executionId}:`, error);
      if (!isClosed) {
        res.end();
      }
    } finally {
      isPolling = false;
    }
  };

  void flushEvents();

  const pollInterval = setInterval(() => {
    void flushEvents();
  }, 750);
  const heartbeatInterval = setInterval(() => {
    if (!isClosed) {
      res.write(': heartbeat\n\n');
    }
  }, 15000);

  const cleanup = () => {
    if (isClosed) {
      return;
    }

    isClosed = true;
    clearInterval(pollInterval);
    clearInterval(heartbeatInterval);
    state.executionSseClients = state.executionSseClients.filter(
      (client) => client !== res,
    );
    console.log(
      `Execution SSE disconnected for ${executionId}. Total clients: ${state.executionSseClients.length}`,
    );
  };

  req.on('close', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
});
