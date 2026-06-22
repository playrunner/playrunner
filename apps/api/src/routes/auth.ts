import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware';
import {
  getLocalAuthPublicUser,
  isLocalAuthConfigured,
  issueLocalAuthToken,
  verifyLocalCredentials,
} from '../auth/local-auth';

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  if (!isLocalAuthConfigured()) {
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
    const isValid = verifyLocalCredentials(username, password);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    const user = getLocalAuthPublicUser();
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

authRouter.get('/me', requireAuth, (req, res) => {
  const username = req.authUser?.username || req.authUser?.name || null;
  res.json({
    user: {
      uid: req.authUser?.providerUserId || null,
      username,
      name: username,
    },
  });
});
