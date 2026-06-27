import express from 'express';
import cors from 'cors';
import path from 'path';
import { PORT } from './config';
import { githubRouter } from '@playrunner/github/api';
import { runnersRouter } from './routes/runners';
import { workflowsRouter } from './routes/workflows';
import { outputsRouter } from './routes/outputs';
import { systemRouter } from './routes/system';
import { executionsRouter } from './routes/executions';
import { authRouter } from './routes/auth';
import { gcpRouter } from './routes/integrations/gcp';
import { jiraRouter } from '@playrunner/jira/api';
import { javascriptRouter } from '@playrunner/javascript/api';
import { requireAuth } from './auth/auth.middleware';
import { loadPremiumApiRoutes } from './premium-routes';
import { apiRuntime } from './runtime';
import { storeRouter } from './routes/store';

const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));

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

app.use('/api', requireAuth);
app.use('/api/github', githubRouter);
app.use('/api/gcp', gcpRouter);
app.use('/api/jira', jiraRouter);
app.use('/api/javascript', javascriptRouter);
app.use('/api/runners', runnersRouter);
app.use('/api/workflows', workflowsRouter);
app.use('/api/store', storeRouter);

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
