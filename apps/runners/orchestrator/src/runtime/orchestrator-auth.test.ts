import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isGcpOrchestratorRequestAuthorized,
  isLocalOrchestratorRequestAuthorized,
} from './orchestrator-auth';

test('requires an exact local API-to-orchestrator token when configured', () => {
  const token = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  assert.equal(isLocalOrchestratorRequestAuthorized(token, token), true);
  assert.equal(isLocalOrchestratorRequestAuthorized(token, 'wrong'), false);
  assert.equal(isLocalOrchestratorRequestAuthorized(token, undefined), false);
});

test('fails closed when no local orchestrator token is configured', () => {
  assert.equal(
    isLocalOrchestratorRequestAuthorized(undefined, undefined),
    false,
  );
  assert.equal(isLocalOrchestratorRequestAuthorized('', undefined), false);
});

test('cryptographically verifies the expected hosted GCP caller and audience', async () => {
  const calls: unknown[] = [];
  const verifier = {
    async verifyIdToken(options: unknown) {
      calls.push(options);
      return {
        getPayload: () => ({
          aud: 'https://orchestrator.example.run.app',
          email: 'playrunner-api@example.iam.gserviceaccount.com',
          email_verified: true,
          iss: 'https://accounts.google.com',
          sub: '1234567890',
        }),
      };
    },
  };

  assert.equal(
    await isGcpOrchestratorRequestAuthorized(
      {
        authorization: 'Bearer header.payload.signature',
        expectedAudience: 'https://orchestrator.example.run.app',
        expectedEmail: 'playrunner-api@example.iam.gserviceaccount.com',
        expectedSubject: '1234567890',
      },
      verifier as never,
    ),
    true,
  );
  assert.deepEqual(calls, [
    {
      audience: 'https://orchestrator.example.run.app',
      idToken: 'header.payload.signature',
    },
  ]);
});

test('hosted GCP auth rejects missing configuration, malformed tokens, and identity mismatches', async () => {
  const verifier = {
    async verifyIdToken() {
      return {
        getPayload: () => ({
          aud: 'https://orchestrator.example.run.app',
          email: 'attacker@example.iam.gserviceaccount.com',
          email_verified: true,
          iss: 'https://accounts.google.com',
          sub: '999',
        }),
      };
    },
  };
  const expected = {
    expectedAudience: 'https://orchestrator.example.run.app',
    expectedEmail: 'playrunner-api@example.iam.gserviceaccount.com',
    expectedSubject: '1234567890',
  };

  assert.equal(
    await isGcpOrchestratorRequestAuthorized(
      { ...expected, authorization: undefined },
      verifier as never,
    ),
    false,
  );
  assert.equal(
    await isGcpOrchestratorRequestAuthorized(
      { ...expected, authorization: 'Bearer not-a-jwt' },
      verifier as never,
    ),
    false,
  );
  assert.equal(
    await isGcpOrchestratorRequestAuthorized(
      { ...expected, authorization: 'Bearer header.payload.signature' },
      verifier as never,
    ),
    false,
  );
});
