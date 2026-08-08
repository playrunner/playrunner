import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import {
  createRequireOutputAccess,
  OUTPUT_SESSION_COOKIE,
} from './output-access';

function createResponse() {
  const result = {
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status: 200,
  };
  const response = {
    json(body: unknown) {
      result.body = body;
      return response;
    },
    status(status: number) {
      result.status = status;
      return response;
    },
    set(name: string, value: string) {
      result.headers[name] = value;
      return response;
    },
  } as unknown as Response;

  return { response, result };
}

function createRequest(
  headers: Request['headers'],
  path = '/execution-1/report',
) {
  return { headers, path } as Request;
}

test('rejects output requests without a login token or session', async () => {
  const middleware = createRequireOutputAccess({
    findExecutionForUser: async () => ({ id: 'execution-1' }),
    verify: async () => ({ provider: 'local', providerUserId: 'user-1' }),
  });
  const { response, result } = createResponse();
  let continued = false;

  await middleware(createRequest({}), response, (() => {
    continued = true;
  }) as NextFunction);

  assert.equal(result.status, 401);
  assert.equal(result.headers['Cache-Control'], 'private, no-store');
  assert.equal(continued, false);
});

test('allows an output session owned by the authenticated user', async () => {
  let lookup: { executionId: string; userId: string } | undefined;
  const middleware = createRequireOutputAccess({
    findExecutionForUser: async (executionId, userId) => {
      lookup = { executionId, userId };
      return { id: executionId };
    },
    verify: async (token) => {
      assert.equal(token, 'valid-token');
      return { provider: 'local', providerUserId: 'user-1' };
    },
  });
  const { response, result } = createResponse();
  let continued = false;

  await middleware(
    createRequest({ cookie: `${OUTPUT_SESSION_COOKIE}=valid-token` }),
    response,
    (() => {
      continued = true;
    }) as NextFunction,
  );

  assert.equal(result.status, 200);
  assert.equal(continued, true);
  assert.deepEqual(lookup, {
    executionId: 'execution-1',
    userId: 'user-1',
  });
});

test('does not reveal outputs owned by a different user', async () => {
  const middleware = createRequireOutputAccess({
    findExecutionForUser: async () => null,
    verify: async () => ({ provider: 'local', providerUserId: 'user-2' }),
  });
  const { response, result } = createResponse();

  await middleware(
    createRequest({ authorization: 'Bearer valid-token' }),
    response,
    (() => assert.fail('middleware should not continue')) as NextFunction,
  );

  assert.equal(result.status, 404);
  assert.deepEqual(result.body, { error: 'Output not found.' });
});

test('rejects an invalid output session', async () => {
  const middleware = createRequireOutputAccess({
    findExecutionForUser: async () => ({ id: 'execution-1' }),
    verify: async () => {
      throw new Error('expired');
    },
  });
  const { response, result } = createResponse();

  await middleware(
    createRequest({ cookie: `${OUTPUT_SESSION_COOKIE}=expired-token` }),
    response,
    (() => assert.fail('middleware should not continue')) as NextFunction,
  );

  assert.equal(result.status, 401);
});
