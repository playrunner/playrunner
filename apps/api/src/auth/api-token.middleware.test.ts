import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { createRequireApiToken } from './api-token.middleware';

function authenticatedToken(id: string) {
  return {
    allowedWorkflowIds: null,
    createdAt: new Date('2026-08-21T00:00:00.000Z'),
    displayPrefix: 'pr_live_test',
    expiresAt: null,
    id,
    lastUsedAt: null,
    name: 'CI',
    revokedAt: null,
    scopes: ['workflow:execute'],
    tokenHash: 'not-a-plaintext-token',
    userId: `user-${id}`,
  };
}

type InvocationOptions = {
  authorization?: string;
  ip?: string;
  method?: string;
  path?: string;
};

async function invoke(
  middleware: ReturnType<typeof createRequireApiToken>,
  options: InvocationOptions = {},
) {
  const headers: Record<string, string> = {};
  let body: unknown;
  let nextCalled = false;
  let status = 200;
  const request = {
    headers: options.authorization
      ? { authorization: options.authorization }
      : {},
    ip: options.ip ?? '203.0.113.10',
    method: options.method ?? 'POST',
    path: options.path ?? '/workflow-1/executions',
  } as Request;
  const response = {
    json(value: unknown) {
      body = value;
      return response;
    },
    setHeader(name: string, value: string | number | readonly string[]) {
      headers[name.toLowerCase()] = String(value);
      return response;
    },
    status(value: number) {
      status = value;
      return response;
    },
  } as unknown as Response;
  await middleware(request, response, (() => {
    nextCalled = true;
  }) as NextFunction);
  return { body, headers, nextCalled, request, status };
}

test('authenticated tenants behind one address receive independent budgets', async () => {
  const middleware = createRequireApiToken({
    authenticate: async (plaintext) =>
      plaintext === 'secret-a'
        ? authenticatedToken('token-a')
        : plaintext === 'secret-b'
          ? authenticatedToken('token-b')
          : null,
    limits: {
      authenticatedControl: 1,
      authenticatedGlobal: 10,
    },
  });

  const tenantA = await invoke(middleware, {
    authorization: 'Bearer secret-a',
  });
  const tenantB = await invoke(middleware, {
    authorization: 'Bearer secret-b',
  });
  const tenantASecondRequest = await invoke(middleware, {
    authorization: 'Bearer secret-a',
  });

  assert.equal(tenantA.nextCalled, true);
  assert.equal(tenantB.nextCalled, true);
  assert.equal(tenantASecondRequest.status, 429);
  assert.equal(tenantASecondRequest.headers['ratelimit-limit'], '1');
  assert.equal(tenantASecondRequest.headers['retry-after'], '60');
  assert.doesNotMatch(
    JSON.stringify({
      body: tenantASecondRequest.body,
      headers: tenantASecondRequest.headers,
      status: tenantASecondRequest.status,
    }),
    /secret-a|secret-b/,
  );
});

test('concurrent execution polling has per-execution budgets', async () => {
  const middleware = createRequireApiToken({
    authenticate: async () => authenticatedToken('shared-token'),
    limits: {
      authenticatedGlobal: 20,
      authenticatedPoll: 2,
    },
  });
  const poll = (executionId: string, events = false) =>
    invoke(middleware, {
      authorization: 'Bearer shared-secret',
      method: 'GET',
      path: `/workflow-1/executions/${executionId}${events ? '/events' : ''}`,
    });

  assert.equal((await poll('execution-a', true)).nextCalled, true);
  assert.equal((await poll('execution-a')).nextCalled, true);
  assert.equal((await poll('execution-b', true)).nextCalled, true);
  assert.equal((await poll('execution-b')).nextCalled, true);
  assert.equal((await poll('execution-a')).status, 429);
});

test('global token budget prevents execution-id bucket bypass', async () => {
  const middleware = createRequireApiToken({
    authenticate: async () => authenticatedToken('shared-token'),
    limits: {
      authenticatedGlobal: 3,
      authenticatedPoll: 2,
    },
  });
  const poll = (executionId: string) =>
    invoke(middleware, {
      authorization: 'Bearer shared-secret',
      method: 'GET',
      path: `/workflow-1/executions/${executionId}`,
    });

  assert.equal((await poll('execution-a')).nextCalled, true);
  assert.equal((await poll('execution-b')).nextCalled, true);
  assert.equal((await poll('execution-c')).nextCalled, true);
  assert.equal((await poll('execution-d')).status, 429);
});

test('blocked unauthenticated clients are rejected before another token lookup', async () => {
  let authenticationCalls = 0;
  const middleware = createRequireApiToken({
    authenticate: async () => {
      authenticationCalls += 1;
      return null;
    },
    limits: { unauthenticated: 1 },
  });

  assert.equal(
    (
      await invoke(middleware, {
        authorization: 'Bearer invalid-secret-1',
      })
    ).status,
    401,
  );
  const blocked = await invoke(middleware, {
    authorization: 'Bearer invalid-secret-2',
  });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers['retry-after'], '60');
  assert.equal(authenticationCalls, 1);
});

test('occasional invalid attempts do not tax valid authenticated traffic', async () => {
  const middleware = createRequireApiToken({
    authenticate: async (plaintext) =>
      plaintext === 'valid-secret' ? authenticatedToken('token-a') : null,
    limits: { unauthenticated: 2 },
  });

  assert.equal(
    (
      await invoke(middleware, {
        authorization: 'Bearer invalid-secret',
      })
    ).status,
    401,
  );
  const valid = await invoke(middleware, {
    authorization: 'Bearer valid-secret',
  });
  assert.equal(valid.nextCalled, true);
  assert.equal(valid.request.authUser?.providerUserId, 'user-token-a');
});

test('rate-limit windows reset deterministically', async () => {
  let now = 1_000;
  const middleware = createRequireApiToken({
    authenticate: async () => authenticatedToken('token-a'),
    limits: { authenticatedControl: 1 },
    now: () => now,
  });
  const request = () =>
    invoke(middleware, { authorization: 'Bearer valid-secret' });

  assert.equal((await request()).nextCalled, true);
  assert.equal((await request()).status, 429);
  now += 60_000;
  assert.equal((await request()).nextCalled, true);
});
