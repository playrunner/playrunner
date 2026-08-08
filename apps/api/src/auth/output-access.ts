import type { NextFunction, Request, Response } from 'express';
import {
  apiTokens,
  API_TOKEN_PREFIX,
  tokenCanExecuteWorkflow,
} from '../services/api-tokens';
import { executionEvents } from '../services/execution-events';
import type { AuthUser } from './auth.types';
import { verifyToken } from './verify-token';

export const OUTPUT_SESSION_COOKIE = '__session';
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
  authenticateApiToken?: (token: string) => Promise<{
    allowedWorkflowIds: unknown;
    scopes: unknown;
    userId: string;
  } | null>;
  findExecutionForUser: (
    executionId: string,
    userId: string,
  ) => Promise<{ workflowId?: string; [key: string]: unknown } | null>;
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
      const isApiToken = token.startsWith(API_TOKEN_PREFIX);
      const apiToken = isApiToken
        ? await dependencies.authenticateApiToken?.(token)
        : null;
      const authUser = isApiToken ? null : await dependencies.verify(token);
      if (isApiToken && !apiToken) {
        res.status(401).json({ error: 'Unauthorized.' });
        return;
      }
      const executionId = req.path.split('/').filter(Boolean)[0];
      if (!executionId) {
        res.status(404).json({ error: 'Output not found.' });
        return;
      }

      const execution = await dependencies.findExecutionForUser(
        executionId,
        apiToken?.userId ?? authUser!.providerUserId,
      );
      if (!execution) {
        res.status(404).json({ error: 'Output not found.' });
        return;
      }
      if (
        apiToken &&
        (!execution.workflowId ||
          !tokenCanExecuteWorkflow(apiToken, execution.workflowId))
      ) {
        res.status(404).json({ error: 'Output not found.' });
        return;
      }

      if (authUser) req.authUser = authUser;
      next();
    } catch {
      res.status(401).json({ error: 'Unauthorized.' });
    }
  };
}

export const requireOutputAccess = createRequireOutputAccess({
  authenticateApiToken: (token) => apiTokens.authenticate(token),
  findExecutionForUser: (executionId, userId) =>
    executionEvents.getExecutionForUser(executionId, userId),
  verify: verifyToken,
});
