import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware';
import { verifyToken } from '../auth/verify-token';
import {
  authenticateLocalCredentials,
  createInvitedLocalUser,
  deleteInvitedLocalUser,
  getLocalAuthPublicUser,
  isLocalAuthConfigured,
  issueLocalAuthToken,
  updateLocalAuthPassword,
} from '../auth/local-auth';
import {
  acceptTeamInvitation,
  getInvitationPreview,
  TeamServiceError,
} from '../services/teams';

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
    const user = await authenticateLocalCredentials(username, password);
    if (!user) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    const token = await issueLocalAuthToken(user.uid, user.username);

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
    const authUser = await verifyToken(token);
    const user = await getLocalAuthPublicUser(authUser.providerUserId);
    res.json({ user });
  } catch {
    res.json({ user: null });
  }
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await getLocalAuthPublicUser(req.authUser!.providerUserId);
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
      userId: req.authUser!.providerUserId,
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

authRouter.get('/invitations/:token', async (req, res) => {
  try {
    res.json({ invitation: await getInvitationPreview(req.params.token) });
  } catch (error) {
    if (error instanceof TeamServiceError) {
      res
        .status(error.statusCode)
        .json({ code: error.code, error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to load the invitation.' });
  }
});

authRouter.post('/register', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email : '';
  const password =
    typeof req.body?.password === 'string' ? req.body.password : '';
  const invitationToken =
    typeof req.body?.invitationToken === 'string'
      ? req.body.invitationToken
      : '';

  if (!email || !password || !invitationToken) {
    res.status(400).json({
      error: 'Invitation token, email address, and password are required.',
    });
    return;
  }

  let user: Awaited<ReturnType<typeof createInvitedLocalUser>> | null = null;
  try {
    const preview = await getInvitationPreview(invitationToken);
    if (
      preview.email.toLocaleLowerCase('en-US') !==
      email.trim().toLocaleLowerCase('en-US')
    ) {
      res.status(403).json({
        code: 'invitation_email_mismatch',
        error: 'Register with the email address that received this invitation.',
      });
      return;
    }

    user = await createInvitedLocalUser({ email, password });
    await acceptTeamInvitation(
      {
        email: user.email ?? undefined,
        emailVerified: true,
        name: user.name,
        provider: 'local',
        providerUserId: user.uid,
        username: user.username,
      },
      invitationToken,
    );
    const token = await issueLocalAuthToken(user.uid, user.username);
    res.status(201).json({ token, user });
  } catch (error) {
    if (user) {
      await deleteInvitedLocalUser(user.uid).catch((cleanupError) => {
        console.error(
          'Failed to roll back invited user registration:',
          cleanupError,
        );
      });
    }
    if (error instanceof TeamServiceError) {
      res
        .status(error.statusCode)
        .json({ code: error.code, error: error.message });
      return;
    }
    const message =
      error instanceof Error ? error.message : 'Registration failed.';
    const conflict = /unique constraint/i.test(message);
    res.status(conflict ? 409 : 400).json({
      error: conflict
        ? 'An account already exists for that email address. Sign in instead.'
        : message,
    });
  }
});
