import assert from 'node:assert/strict';
import test from 'node:test';
import { ExecutionAuthenticationGrants } from './execution-authentication';

test('persists execution Authentication Profile grants for scaled runners', async () => {
  const calls: Array<{ operation: string; value: unknown }> = [];
  const store = {
    deleteMany: async (value: unknown) => {
      calls.push({ operation: 'deleteMany', value });
      return { count: 1 };
    },
    findFirst: async (value: unknown) => {
      calls.push({ operation: 'findFirst', value });
      return { executionId: 'execution-1' };
    },
    findUniqueOrThrow: async () => {
      throw new Error('not used');
    },
    updateMany: async () => ({ count: 0 }),
    upsert: async (value: unknown) => {
      calls.push({ operation: 'upsert', value });
      return {};
    },
  } as unknown as ConstructorParameters<
    typeof ExecutionAuthenticationGrants
  >[0];
  const grants = new ExecutionAuthenticationGrants(store);

  await grants.register({
    executionId: 'execution-1',
    nodeId: 'playwright-1',
    ownerUserId: 'user-1',
    profileId: 'profile-1',
  });
  assert.equal(await grants.has('execution-1', 'playwright-1'), true);
  await grants.clearExecution('execution-1');

  assert.deepEqual(
    calls.map(({ operation }) => operation),
    ['upsert', 'findFirst', 'deleteMany'],
  );
  const registration = calls[0].value as {
    create: { expiresAt: Date; profileId: string };
  };
  assert.equal(registration.create.profileId, 'profile-1');
  assert.ok(registration.create.expiresAt.getTime() > Date.now());
});
