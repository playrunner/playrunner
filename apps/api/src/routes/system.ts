import { Router } from 'express';
import { state } from '../state';

export const systemRouter = Router();

// SSE Endpoint for frontend to subscribe to logs
systemRouter.get('/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Send an initial heartbeat
  res.write(': heartbeat\n\n');
  
  state.sseClients.push(res);
  console.log(`SSE Client connected. Total clients: ${state.sseClients.length}`);
  
  req.on('close', () => {
    state.sseClients = state.sseClients.filter(client => client !== res);
    console.log(`SSE Client disconnected. Total clients: ${state.sseClients.length}`);
  });
});

systemRouter.get('/heartbeat', (req, res) => {
  if (state.sseClients.length > 0) {
    res.status(200).send('OK');
  } else {
    res.status(404).send('No editor connected');
  }
});
