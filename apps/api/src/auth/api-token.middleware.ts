import type { NextFunction, Request, Response } from 'express';
import { apiTokens } from '../services/api-tokens';

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 240;
const attempts = new Map<string, { count: number; resetAt: number }>();

function bearerToken(req: Request) {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  return token || null;
}

function isRateLimited(req: Request) {
  const now = Date.now();
  const key = req.ip || 'unknown';
  if (attempts.size > 1000) {
    for (const [candidate, entry] of attempts) {
      if (entry.resetAt <= now) attempts.delete(candidate);
    }
  }
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > MAX_REQUESTS_PER_WINDOW;
}

export async function requireApiToken(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const plaintext = bearerToken(req);
  if (!plaintext) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (isRateLimited(req)) {
    res.status(429).json({ error: 'Too many requests.' });
    return;
  }
  const token = await apiTokens.authenticate(plaintext);
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  req.apiToken = token;
  req.authUser = { provider: 'api-token', providerUserId: token.userId };
  next();
}
