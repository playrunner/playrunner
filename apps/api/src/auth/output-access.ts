import type { NextFunction, Request, Response } from 'express';
import { executionEvents } from '../services/execution-events';
import type { AuthUser } from './auth.types';
import { verifyToken } from './verify-token';

export const OUTPUT_SESSION_COOKIE = 'playrunner_output_session';
const OUTPUT_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function isSecureRequest(req: Request) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto;

  return req.secure || protocol?.split(',')[0]?.trim() === 'https';
}

function readCookie(req: Request, name: string) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return '';

  for (const cookie of cookieHeader.split(';')) {
    const separatorIndex = cookie.indexOf('=');
    if (separatorIndex === -1) continue;

    const cookieName = cookie.slice(0, separatorIndex).trim();
    if (cookieName !== name) continue;

    try {
      return decodeURIComponent(cookie.slice(separatorIndex + 1).trim());
    } catch {
      return '';
    }
  }

  return '';
}

function getBearerToken(req: Request) {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) return '';
  return authorization.slice('Bearer '.length).trim();
}

export function setOutputSessionCookie(
  req: Request,
  res: Response,
  token: string,
) {
  res.cookie(OUTPUT_SESSION_COOKIE, token, {
    httpOnly: true,
    maxAge: OUTPUT_SESSION_MAX_AGE_MS,
    path: '/outputs',
    sameSite: 'lax',
    secure: isSecureRequest(req),
  });
}

export function clearOutputSessionCookie(req: Request, res: Response) {
  res.clearCookie(OUTPUT_SESSION_COOKIE, {
    httpOnly: true,
    path: '/outputs',
    sameSite: 'lax',
    secure: isSecureRequest(req),
  });
}

export function createRequireOutputAccess(dependencies: {
  findExecutionForUser: (
    executionId: string,
    userId: string,
  ) => Promise<unknown>;
  verify: (token: string) => Promise<AuthUser>;
}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    res.set('Cache-Control', 'private, no-store');

    const token = getBearerToken(req) || readCookie(req, OUTPUT_SESSION_COOKIE);

    if (!token) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    try {
      const authUser = await dependencies.verify(token);
      const executionId = req.path.split('/').filter(Boolean)[0];
      if (!executionId) {
        res.status(404).json({ error: 'Output not found.' });
        return;
      }

      const execution = await dependencies.findExecutionForUser(
        executionId,
        authUser.providerUserId,
      );
      if (!execution) {
        res.status(404).json({ error: 'Output not found.' });
        return;
      }

      req.authUser = authUser;
      next();
    } catch {
      res.status(401).json({ error: 'Unauthorized.' });
    }
  };
}

export const requireOutputAccess = createRequireOutputAccess({
  findExecutionForUser: (executionId, userId) =>
    executionEvents.getExecutionForUser(executionId, userId),
  verify: verifyToken,
});
