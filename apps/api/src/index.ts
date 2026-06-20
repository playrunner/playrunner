import express from 'express';
import cors from 'cors';
import path from 'path';
import { PORT } from './config';
import { githubRouter } from './routes/integrations/github';
import { runnersRouter } from './routes/runners';
import { workflowsRouter } from './routes/workflows';
import { outputsRouter } from './routes/outputs';
import { systemRouter } from './routes/system';
import { authRouter } from './routes/auth';
import { gcpRouter } from './routes/integrations/gcp';
import { jiraRouter } from './routes/integrations/jira';
import { requireAuth } from './auth/auth.middleware';
import { loadPremiumApiRoutes } from './premium-routes';
import { apiRuntime } from './runtime';

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

// Routes that don't require user auth: heartbeat, logs stream, and runner output uploads
app.use('/api', systemRouter); 
app.use('/api/outputs', outputsRouter);

app.use('/api', requireAuth);
app.use('/api/github', githubRouter);
app.use('/api/gcp', gcpRouter);
app.use('/api/jira', jiraRouter);
app.use('/api/runners', runnersRouter);
app.use('/api/workflows', workflowsRouter);
app.use('/api/auth', authRouter);

async function start() {
  await apiRuntime.ready;
  await loadPremiumApiRoutes(app);
  void apiRuntime.logTransport.setup();

  app.listen(PORT, () => {
    console.log(`API Server running on port ${PORT} (SSE Enabled)`);
  });
}

start().catch((error) => {
  console.error('Failed to start API runtime:', error);
  process.exit(1);
});
