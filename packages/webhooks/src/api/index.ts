import express, { Router } from 'express';
import type {
  IntegrationApiHost,
  IntegrationCredentialStore,
} from '@playrunner/integration-sdk/api';

const MAX_REQUEST_BYTES = 1_048_576;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 60;
const requestWindows = new Map<string, { count: number; startedAt: number }>();
let apiHost: IntegrationApiHost | null = null;

function host() {
  if (!apiHost) throw new Error('Webhooks API host is not configured.');
  return apiHost;
}

function userId(req: unknown) {
  const id = (req as { authUser?: { providerUserId?: string } }).authUser
    ?.providerUserId;
  if (!id) throw Object.assign(new Error('Unauthorized.'), { statusCode: 401 });
  return id;
}

function credentialStore(req: unknown): IntegrationCredentialStore | undefined {
  return (req as { integrationCredentials?: IntegrationCredentialStore })
    .integrationCredentials;
}

function endpointInput(req: any) {
  const workflowId =
    typeof req.body?.workflowId === 'string' ? req.body.workflowId : '';
  const nodeId = typeof req.body?.nodeId === 'string' ? req.body.nodeId : '';
  if (!workflowId || !nodeId) {
    throw Object.assign(new Error('workflowId and nodeId are required.'), {
      statusCode: 400,
    });
  }
  return { nodeId, userId: userId(req), workflowId };
}

function handleError(error: unknown, res: any) {
  const status =
    error &&
    typeof error === 'object' &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
      ? error.statusCode
      : 500;
  res.status(status).json({
    error:
      status === 500
        ? 'Webhook operation failed.'
        : String((error as Error).message),
  });
}

function isRateLimited(key: string) {
  const now = Date.now();
  const current = requestWindows.get(key);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    if (requestWindows.size >= 10_000) {
      const oldestKey = requestWindows.keys().next().value;
      if (oldestKey) requestWindows.delete(oldestKey);
    }
    requestWindows.set(key, { count: 1, startedAt: now });
    return false;
  }
  current.count += 1;
  return current.count > MAX_REQUESTS_PER_WINDOW;
}

export const webhooksRouter = Router();
export const publicWebhooksRouter = Router();

webhooksRouter.get('/endpoint', async (req, res) => {
  try {
    const workflowId =
      typeof req.query.workflowId === 'string' ? req.query.workflowId : '';
    const nodeId = typeof req.query.nodeId === 'string' ? req.query.nodeId : '';
    if (!workflowId || !nodeId) {
      res.status(400).json({ error: 'workflowId and nodeId are required.' });
      return;
    }
    const endpoint = await host().inboundWebhooks.getEndpoint({
      nodeId,
      userId: userId(req),
      workflowId,
    });
    res.json({ endpoint });
  } catch (error) {
    handleError(error, res);
  }
});

webhooksRouter.post('/endpoint', async (req, res) => {
  try {
    const endpoint = await host().inboundWebhooks.createOrRotateEndpoint({
      ...endpointInput(req),
      enabled: req.body?.enabled !== false,
    });
    res.status(201).json({ endpoint });
  } catch (error) {
    handleError(error, res);
  }
});

webhooksRouter.patch('/endpoint', async (req, res) => {
  try {
    await host().inboundWebhooks.setEnabled({
      ...endpointInput(req),
      enabled: req.body?.enabled === true,
    });
    res.status(204).send();
  } catch (error) {
    handleError(error, res);
  }
});

webhooksRouter.get('/tunnel', (_req, res) => {
  res.json(host().tunnel.getState());
});

webhooksRouter.get('/settings', async (req, res) => {
  try {
    const store = credentialStore(req);
    if (!store) throw new Error('Credential storage is unavailable.');
    const connection = await store.resolve('integration', 'webhooks');
    res.json({
      config: connection?.config ?? {
        exposureMode: 'none',
        publicUrl: '',
      },
      credentialStatus: {
        configured: Boolean(connection?.secrets.bearerToken),
      },
      localBaseUrl: `${req.protocol}://${req.get('host')}`,
      tunnel: host().tunnel.getState(),
    });
  } catch (error) {
    handleError(error, res);
  }
});

webhooksRouter.post('/tunnel/start', (_req, res) => {
  const current = host().tunnel.getState();
  if (current.status === 'running' || current.status === 'starting') {
    res.status(current.status === 'running' ? 200 : 202).json(current);
    return;
  }

  void host()
    .tunnel.start()
    .catch(() => {
      // The service records the safe error and output for status polling.
    });
  res.status(202).json(host().tunnel.getState());
});

webhooksRouter.post('/tunnel/stop', (_req, res) => {
  host().tunnel.stop();
  res.json(host().tunnel.getState());
});

webhooksRouter.put('/settings', async (req, res) => {
  try {
    const store = credentialStore(req);
    if (!store) throw new Error('Credential storage is unavailable.');
    const exposureMode = ['none', 'public-url', 'cloudflare'].includes(
      req.body?.exposureMode,
    )
      ? req.body.exposureMode
      : 'none';
    const publicUrl =
      typeof req.body?.publicUrl === 'string'
        ? req.body.publicUrl.trim().replace(/\/+$/, '')
        : '';
    if (exposureMode === 'public-url') {
      try {
        if (!publicUrl || new URL(publicUrl).protocol !== 'https:') {
          throw new Error();
        }
      } catch {
        throw Object.assign(new Error('Public URL must use HTTPS.'), {
          statusCode: 400,
        });
      }
    }
    await store.save('integration', 'webhooks', {
      provider: 'webhooks',
      config: { exposureMode, publicUrl },
      secrets:
        typeof req.body?.bearerToken === 'string' && req.body.bearerToken
          ? { bearerToken: req.body.bearerToken }
          : undefined,
    });
    if (exposureMode !== 'cloudflare') host().tunnel.stop();
    res.json({ saved: true });
  } catch (error) {
    handleError(error, res);
  }
});

publicWebhooksRouter.post(
  '/inbound/:endpointId/:secret',
  express.raw({ limit: MAX_REQUEST_BYTES, type: '*/*' }),
  async (req, res) => {
    const contentLength = Number(req.get('content-length') || 0);
    const rateKey = `${req.ip}:${req.params.endpointId}`;
    if (contentLength > MAX_REQUEST_BYTES) {
      res.status(413).json({ error: 'Webhook request is too large.' });
      return;
    }
    if (isRateLimited(rateKey)) {
      res.status(429).json({ error: 'Too many webhook requests.' });
      return;
    }
    try {
      const result = await host().inboundWebhooks.dispatch(
        req.params.endpointId,
        req.params.secret,
        {
          body: parseInboundBody(req.body, req.get('content-type')),
          headers: req.headers,
          method: req.method,
          query: req.query,
        },
      );
      if (!result) {
        res.status(404).json({ error: 'Webhook endpoint was not found.' });
        return;
      }
      res.status(202).json(result);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'statusCode' in error &&
        error.statusCode === 400
      ) {
        handleError(error, res);
        return;
      }
      res.status(503).json({ error: 'Workflow could not be started.' });
    }
  },
);

function parseInboundBody(body: unknown, contentType = '') {
  if (!Buffer.isBuffer(body)) return body;
  if (body.length === 0) return null;
  const text = body.toString('utf8');
  if (contentType.toLowerCase().includes('application/json')) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw Object.assign(new Error('Webhook JSON body is malformed.'), {
        statusCode: 400,
      });
    }
  }
  if (contentType.toLowerCase().includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  return text;
}

export const webhooksApiContribution = {
  configure(nextHost: IntegrationApiHost) {
    apiHost = nextHost;
  },
  id: 'webhooks',
  mountPath: '/api/webhooks',
  publicRouter: publicWebhooksRouter,
  router: webhooksRouter,
};

export default webhooksApiContribution;
