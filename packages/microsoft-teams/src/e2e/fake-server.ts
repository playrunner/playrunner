import express from 'express';

const app = express();
app.use(express.urlencoded({ extended: false }));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.post('/:tenant/oauth2/v2.0/token', (req, res) => {
  if (
    req.params.tenant !== 'playrunner-e2e' ||
    !String(req.body.client_secret).startsWith('fake-') ||
    !/^[A-Za-z0-9_-]{43}$/.test(req.body.code_verifier ?? '')
  ) {
    return res.status(400).json({ error: 'invalid_grant' });
  }
  return res.json({
    access_token: 'teams-e2e-access',
    refresh_token: 'teams-e2e-refresh',
    expires_in: 3600,
  });
});
app.use('/v1.0', (req, res, next) => {
  if (req.headers.authorization !== 'Bearer teams-e2e-access')
    return res.sendStatus(401);
  next();
});
app.get('/v1.0/me/joinedTeams', (_req, res) =>
  res.json({
    value: [
      { id: 'engineering', displayName: 'Engineering' },
      { id: 'quality', displayName: 'Quality' },
    ],
  }),
);
app.get('/v1.0/teams/:teamId/channels', (req, res) =>
  res.json({
    value: [
      { id: `${req.params.teamId}-general`, displayName: 'General' },
      { id: `${req.params.teamId}-results`, displayName: 'Test Results' },
    ],
  }),
);
const server = app.listen(4014, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => server.close());
