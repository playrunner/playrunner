import { Router, type Request, type Response } from 'express';
import { localAuthenticationAgent } from '../services/authentication-agent';
import {
  createAuthenticationProfile,
  deleteAuthenticationProfile,
  listAuthenticationProfiles,
  revokeAuthenticationProfile,
  storeAuthenticationState,
  updateAuthenticationProfile,
} from '../services/authentication-profiles';
import crypto from 'node:crypto';

export const authenticationProfilesRouter = Router();

function userId(req: Request) {
  const value = req.authUser?.providerUserId;
  if (!value) {
    throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
  }
  return value;
}

function sendError(res: Response, error: unknown) {
  const statusCode =
    typeof (error as { statusCode?: unknown })?.statusCode === 'number'
      ? (error as { statusCode: number }).statusCode
      : 500;
  res.status(statusCode).json({
    code:
      typeof (error as { code?: unknown })?.code === 'string'
        ? (error as { code: string }).code
        : undefined,
    error:
      statusCode >= 500
        ? 'Authentication Profile request failed.'
        : error instanceof Error
          ? error.message
          : 'Authentication Profile request failed.',
  });
}

function requireCompanionUpload(req: Request) {
  const expected = process.env.PLAYRUNNER_LOCAL_AUTH_JWT_SECRET || '';
  const supplied = req.get('x-playrunner-companion-secret') || '';
  if (
    expected.length < 32 ||
    supplied.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  ) {
    throw Object.assign(new Error('Unauthorized'), {
      code: 'companion_upload_unauthorized',
      statusCode: 401,
    });
  }
}

function route(handler: (req: Request, res: Response) => Promise<void> | void) {
  return (req: Request, res: Response) => {
    Promise.resolve(handler(req, res)).catch((error) => sendError(res, error));
  };
}

authenticationProfilesRouter.get('/capability', (_req, res) => {
  res.json(localAuthenticationAgent.availability());
});

authenticationProfilesRouter.get(
  '/sessions/:sessionId',
  route((req, res) => {
    res.json({
      session: localAuthenticationAgent.get(userId(req), req.params.sessionId),
    });
  }),
);

authenticationProfilesRouter.post(
  '/sessions/:sessionId/complete',
  route(async (req, res) => {
    res.json({
      session: await localAuthenticationAgent.complete(
        userId(req),
        req.params.sessionId,
      ),
    });
  }),
);

authenticationProfilesRouter.post(
  '/sessions/:sessionId/cancel',
  route(async (req, res) => {
    res.json({
      session: await localAuthenticationAgent.cancel(
        userId(req),
        req.params.sessionId,
      ),
    });
  }),
);

authenticationProfilesRouter.get(
  '/',
  route(async (req, res) => {
    res.json({ profiles: await listAuthenticationProfiles(userId(req)) });
  }),
);

authenticationProfilesRouter.post(
  '/',
  route(async (req, res) => {
    res.status(201).json({
      profile: await createAuthenticationProfile(userId(req), req.body),
    });
  }),
);

authenticationProfilesRouter.put(
  '/:id',
  route(async (req, res) => {
    res.json({
      profile: await updateAuthenticationProfile(
        userId(req),
        req.params.id,
        req.body,
      ),
    });
  }),
);

authenticationProfilesRouter.delete(
  '/:id',
  route(async (req, res) => {
    const actorId = userId(req);
    await localAuthenticationAgent.cancelProfile(actorId, req.params.id);
    await deleteAuthenticationProfile(actorId, req.params.id);
    res.status(204).end();
  }),
);

authenticationProfilesRouter.post(
  '/:id/authenticate',
  route(async (req, res) => {
    res.status(202).json({
      session: await localAuthenticationAgent.start(
        userId(req),
        req.params.id,
        'authenticate',
      ),
    });
  }),
);

authenticationProfilesRouter.post(
  '/:id/test',
  route(async (req, res) => {
    res.status(202).json({
      session: await localAuthenticationAgent.start(
        userId(req),
        req.params.id,
        'test',
      ),
    });
  }),
);

authenticationProfilesRouter.post(
  '/:id/revoke',
  route(async (req, res) => {
    const actorId = userId(req);
    await localAuthenticationAgent.cancelProfile(actorId, req.params.id);
    res.json({
      profile: await revokeAuthenticationProfile(actorId, req.params.id),
    });
  }),
);

authenticationProfilesRouter.post(
  '/:id/companion-state',
  route(async (req, res) => {
    requireCompanionUpload(req);
    const actorId = userId(req);
    res.json({
      profile: await storeAuthenticationState({
        actorId,
        profileId: req.params.id,
        sessionId: String(req.body?.sessionId || ''),
        state: req.body?.state,
      }),
    });
  }),
);
