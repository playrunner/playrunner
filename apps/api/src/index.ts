import express from 'express';
import cors from 'cors';
import path from 'path';
import { PORT } from './config';
import { registerIntegrationApiRoutes } from './integrations/package-registry';
import { runnersRouter } from './routes/runners';
import { workflowsRouter } from './routes/workflows';
import { outputsRouter } from './routes/outputs';
import { systemRouter } from './routes/system';
import { executionsRouter } from './routes/executions';
import { authRouter } from './routes/auth';
import { insightsRouter } from './routes/insights';
import { schedulerRouter } from './routes/scheduler';
import { requireAuth } from './auth/auth.middleware';
import { loadPremiumApiRoutes } from './premium-routes';
import { apiRuntime } from './runtime';
import { storeRouter } from './routes/store';
import { createIntegrationCredentialStore } from './services/connections';

const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));

app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

// Serve static outputs with a proxy for GCP bucket streams
app.use('/outputs', async (req, res, next) => {
  if (await apiRuntime.outputProxy.tryHandle(req, res)) {
    return;
  }
  next();
});

app.use('/outputs', express.static(path.join(__dirname, '../public/outputs')));

// Mixed-auth routes: editor presence stream, execution event ingestion/streaming, and runner output uploads.
app.use('/api', systemRouter);
app.use('/api/executions', executionsRouter);
app.use('/api/outputs', outputsRouter);
app.use('/api/auth', authRouter);
app.use('/api/scheduler', schedulerRouter);

app.use('/api', requireAuth);
app.use('/api', (req, _res, next) => {
  const userId = req.authUser!.providerUserId;
  req.integrationCredentials = createIntegrationCredentialStore(userId);
  next();
});
registerIntegrationApiRoutes(app);
app.use('/api/runners', runnersRouter);
app.use('/api/workflows', workflowsRouter);
app.use('/api/store', storeRouter);
app.use('/api/insights', insightsRouter);
app.use('/api/reports', insightsRouter);

async function start() {
  await apiRuntime.ready;
  await loadPremiumApiRoutes(app);
  void apiRuntime.logTransport.setup();

  app.listen(PORT, () => {
    console.log(`API Server running on port ${PORT} (execution SSE enabled)`);
  });
}

start().catch((error) => {
  console.error('Failed to start API runtime:', error);
  process.exit(1);
});
