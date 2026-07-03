import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware';
import { verifyToken } from '../auth/verify-token';
import {
  getLocalAuthPublicUser,
  isLocalAuthConfigured,
  issueLocalAuthToken,
  updateLocalAuthPassword,
  verifyLocalCredentials,
} from '../auth/local-auth';

export const authRouter = Router();

function getBearerToken(authHeader: unknown) {
  if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return '';
  }

  return authHeader.slice('Bearer '.length).trim();
}

authRouter.post('/login', async (req, res) => {
  if (!(await isLocalAuthConfigured())) {
    res.status(503).json({
      error:
        'Local auth has not been configured yet. Run ./start-local.sh to complete setup.',
    });
    return;
  }

  const username =
    typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password =
    typeof req.body?.password === 'string' ? req.body.password : '';

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required.' });
    return;
  }

  try {
    const isValid = await verifyLocalCredentials(username, password);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    const user = await getLocalAuthPublicUser();
    const token = await issueLocalAuthToken(user.username);

    res.json({ token, user });
  } catch (error) {
    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : 'Failed to validate local credentials.',
    });
  }
});

authRouter.get('/session', async (req, res) => {
  const token = getBearerToken(req.headers.authorization);
  if (!token) {
    res.json({ user: null });
    return;
  }

  try {
    await verifyToken(token);
    const user = await getLocalAuthPublicUser();
    res.json({ user });
  } catch {
    res.json({ user: null });
  }
});

authRouter.get('/me', requireAuth, async (_req, res) => {
  const user = await getLocalAuthPublicUser();
  res.json({ user });
});

authRouter.post('/password', requireAuth, async (req, res) => {
  const currentPassword =
    typeof req.body?.currentPassword === 'string'
      ? req.body.currentPassword
      : '';
  const newPassword =
    typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

  if (!currentPassword || !newPassword) {
    res
      .status(400)
      .json({ error: 'Current password and new password are required.' });
    return;
  }

  if (newPassword.trim().length < 8) {
    res
      .status(400)
      .json({ error: 'New password must be at least 8 characters.' });
    return;
  }

  try {
    await updateLocalAuthPassword({
      currentPassword,
      newPassword,
    });
    res.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to change password.';
    res
      .status(message === 'Current password is incorrect.' ? 400 : 500)
      .json({ error: message });
  }
});
