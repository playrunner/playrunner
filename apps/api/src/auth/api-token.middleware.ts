import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { apiTokens } from '../services/api-tokens';

const WINDOW_MS = 60_000;
const DEFAULT_LIMITS = {
  authenticatedControl: 120,
  authenticatedGlobal: 6_000,
  authenticatedPoll: 240,
  unauthenticated: 30,
} as const;
const DEFAULT_MAX_BUCKETS = 10_000;

type ApiTokenRateLimits = Record<keyof typeof DEFAULT_LIMITS, number>;

type AuthenticatedApiToken = NonNullable<
  Awaited<ReturnType<typeof apiTokens.authenticate>>
>;

type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

export type ApiTokenMiddlewareOptions = {
  authenticate?: (plaintext: string) => Promise<AuthenticatedApiToken | null>;
  limits?: Partial<ApiTokenRateLimits>;
  maxBuckets?: number;
  now?: () => number;
};

class FixedWindowBuckets {
  private readonly entries = new Map<string, RateLimitEntry>();

  constructor(
    private readonly now: () => number,
    private readonly maxBuckets: number,
  ) {}

  consume(key: string, limit: number): RateLimitDecision {
    const now = this.now();
    let current = this.entries.get(key);
    if (!current || current.resetAt <= now) {
      this.makeRoom(now);
      current = { count: 0, resetAt: now + WINDOW_MS };
      this.entries.set(key, current);
    }
    current.count += 1;
    return {
      allowed: current.count <= limit,
      limit,
      remaining: Math.max(0, limit - current.count),
      resetAt: current.resetAt,
    };
  }

  blocked(key: string, limit: number): RateLimitDecision | null {
    const now = this.now();
    const current = this.entries.get(key);
    if (!current) return null;
    if (current.resetAt <= now) {
      this.entries.delete(key);
      return null;
    }
    if (current.count < limit) return null;
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetAt: current.resetAt,
    };
  }

  private makeRoom(now: number) {
    if (this.entries.size < this.maxBuckets) return;
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
    while (this.entries.size >= this.maxBuckets) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
  }
}

function bearerToken(req: Request) {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  return token || null;
}

function opaqueKey(value: string) {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

function clientBucket(req: Request) {
  return `unauthenticated:${opaqueKey(req.ip || 'unknown')}`;
}

function pollingExecutionBucket(req: Request, tokenKey: string) {
  if (req.method !== 'GET') return null;
  const routerPath = req.path;
  const originalPath = req.originalUrl?.split('?', 1)[0] ?? '';
  const match =
    /^\/([^/]+)\/executions\/([^/]+)(?:\/events)?\/?$/.exec(routerPath) ??
    /^\/api\/v1\/workflows\/([^/]+)\/executions\/([^/]+)(?:\/events)?\/?$/.exec(
      originalPath,
    );
  if (!match) return null;
  return `authenticated:${tokenKey}:poll:${opaqueKey(`${match[1]}\0${match[2]}`)}`;
}

function rejectRateLimited(
  res: Response,
  decision: RateLimitDecision,
  now: number,
) {
  const retryAfter = Math.max(1, Math.ceil((decision.resetAt - now) / 1_000));
  res.setHeader('RateLimit-Limit', String(decision.limit));
  res.setHeader('RateLimit-Remaining', String(decision.remaining));
  res.setHeader('RateLimit-Reset', String(Math.ceil(decision.resetAt / 1_000)));
  res.setHeader('Retry-After', String(retryAfter));
  res.status(429).json({ error: 'Too many requests.' });
}

export function createRequireApiToken(options: ApiTokenMiddlewareOptions = {}) {
  const now = options.now ?? Date.now;
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const buckets = new FixedWindowBuckets(
    now,
    Math.max(100, options.maxBuckets ?? DEFAULT_MAX_BUCKETS),
  );
  const authenticate = options.authenticate ?? apiTokens.authenticate;

  return async function requireApiTokenMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    const plaintext = bearerToken(req);
    if (!plaintext) {
      const decision = buckets.consume(
        clientBucket(req),
        limits.unauthenticated,
      );
      if (!decision.allowed) {
        rejectRateLimited(res, decision, now());
        return;
      }
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const unauthenticatedBucket = clientBucket(req);
    const blocked = buckets.blocked(
      unauthenticatedBucket,
      limits.unauthenticated,
    );
    if (blocked) {
      rejectRateLimited(res, blocked, now());
      return;
    }

    const token = await authenticate(plaintext);
    if (!token) {
      const decision = buckets.consume(
        unauthenticatedBucket,
        limits.unauthenticated,
      );
      if (!decision.allowed) {
        rejectRateLimited(res, decision, now());
        return;
      }
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const tokenKey = opaqueKey(token.id);
    const globalDecision = buckets.consume(
      `authenticated:${tokenKey}:global`,
      limits.authenticatedGlobal,
    );
    if (!globalDecision.allowed) {
      rejectRateLimited(res, globalDecision, now());
      return;
    }
    const pollBucket = pollingExecutionBucket(req, tokenKey);
    const scopedDecision = buckets.consume(
      pollBucket ?? `authenticated:${tokenKey}:control`,
      pollBucket ? limits.authenticatedPoll : limits.authenticatedControl,
    );
    if (!scopedDecision.allowed) {
      rejectRateLimited(res, scopedDecision, now());
      return;
    }

    req.apiToken = token;
    req.authUser = { provider: 'api-token', providerUserId: token.userId };
    next();
  };
}

export const requireApiToken = createRequireApiToken();
