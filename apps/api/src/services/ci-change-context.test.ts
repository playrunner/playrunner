import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CiChangeContextValidationError,
  MAX_CI_CHANGE_CONTEXT_BYTES,
  parseCiChangeContext,
} from './ci-change-context';

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'B'.repeat(64);

function validContext() {
  return {
    baseRef: 'main',
    baseSha: BASE_SHA,
    eventType: 'pull_request',
    headRef: 'feature/validator-memory',
    headSha: HEAD_SHA,
    pullRequestNumber: 42,
    repository: { name: 'PlayRunner', owner: 'PlayRunner' },
  };
}

test('normalizes an exact bounded CI change context', () => {
  assert.deepEqual(parseCiChangeContext(validContext()), {
    baseRef: 'main',
    baseSha: BASE_SHA,
    eventType: 'pull_request',
    headRef: 'feature/validator-memory',
    headSha: HEAD_SHA.toLowerCase(),
    pullRequestNumber: 42,
    repository: 'playrunner/playrunner',
  });
});

test('defaults an omitted event type to manual', () => {
  const input = validContext();
  delete (input as Partial<typeof input>).eventType;
  delete (input as Partial<typeof input>).pullRequestNumber;
  assert.equal(parseCiChangeContext(input).eventType, 'manual');
});

test('requires a pull request number exactly for pull request events', () => {
  const pullRequest = validContext();
  delete (pullRequest as Partial<typeof pullRequest>).pullRequestNumber;
  assert.throws(
    () => parseCiChangeContext(pullRequest),
    /required for pull_request events/,
  );
  assert.throws(
    () =>
      parseCiChangeContext({
        ...validContext(),
        eventType: 'push',
      }),
    /only allowed for pull_request events/,
  );
});

test('rejects client-owned memory and arbitrary nested fields', () => {
  assert.throws(
    () =>
      parseCiChangeContext({
        ...validContext(),
        agentMemoryByNodeId: { agent: { summary: 'untrusted' } },
      }),
    CiChangeContextValidationError,
  );
  assert.throws(
    () =>
      parseCiChangeContext({
        ...validContext(),
        repository: {
          name: 'playrunner',
          owner: 'playrunner',
          token: 'untrusted',
        },
      }),
    CiChangeContextValidationError,
  );
});

test('rejects unsafe refs, abbreviated SHAs, invalid PRs, and oversized input', () => {
  assert.throws(
    () => parseCiChangeContext({ ...validContext(), headRef: '../main' }),
    /safe branch name/,
  );
  assert.throws(
    () => parseCiChangeContext({ ...validContext(), headRef: 'HEAD' }),
    /safe branch name/,
  );
  assert.throws(
    () =>
      parseCiChangeContext({
        ...validContext(),
        baseRef: 'refs/heads/main',
      }),
    /safe branch name/,
  );
  assert.throws(
    () => parseCiChangeContext({ ...validContext(), headSha: 'abc123' }),
    /40 or 64 character hexadecimal/,
  );
  assert.throws(
    () => parseCiChangeContext({ ...validContext(), headSha: 'a'.repeat(41) }),
    /40 or 64 character hexadecimal/,
  );
  assert.throws(
    () => parseCiChangeContext({ ...validContext(), pullRequestNumber: 0 }),
    /positive 32-bit integer/,
  );
  assert.throws(
    () =>
      parseCiChangeContext({
        ...validContext(),
        headSha: BASE_SHA.toUpperCase(),
      }),
    /different commits/,
  );
  assert.throws(
    () =>
      parseCiChangeContext({
        ...validContext(),
        repository: { name: 'playrunner-', owner: 'playrunner' },
      }),
    /safe path segments/,
  );
  assert.throws(
    () =>
      parseCiChangeContext({
        ...validContext(),
        unknown: 'x'.repeat(MAX_CI_CHANGE_CONTEXT_BYTES),
      }),
    /exceeds/,
  );
});
