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

test('delivers every profile and alias in an execution-bound envelope', async () => {
  const { createAuthenticationEnvelopeKeyPair, openAuthenticationEnvelope } =
    await import('../../../runners/shared/authentication-envelope');
  let stored: any;
  const selections = [
    {
      profileId: 'bunker',
      environmentVariable: 'E2E_REGRESSION_STORAGE_STATE',
    },
    {
      profileId: 'steadfast',
      environmentVariable: 'E2E_STEADFAST_STORAGE_STATE',
    },
  ];
  const store = {
    upsert: async ({ create }: any) => {
      stored = create;
    },
    updateMany: async () => ({ count: 1 }),
    findUniqueOrThrow: async () => stored,
  } as unknown as ConstructorParameters<
    typeof ExecutionAuthenticationGrants
  >[0];
  const resolved: string[] = [];
  const resolve = async (owner: string, id: string) => {
    assert.equal(owner, 'owner');
    resolved.push(id);
    return {
      state: {
        cookies: [],
        origins: [
          {
            origin: `https://${id}.test`,
            localStorage: [{ name: 'session', value: `${id}-secret` }],
          },
        ],
      },
    };
  };
  const grants = new ExecutionAuthenticationGrants(store, resolve as any);
  await grants.register({
    executionId: 'run',
    nodeId: 'node',
    ownerUserId: 'owner',
    profiles: selections,
  });
  assert.deepEqual(stored.profiles, selections);
  assert.equal(JSON.stringify(stored).includes('-secret'), false);
  const keys = createAuthenticationEnvelopeKeyPair();
  const envelope = await grants.seal({
    executionId: 'run',
    nodeId: 'node',
    recipientPublicKey: keys.publicKey,
  });
  const plaintext = openAuthenticationEnvelope({
    envelope,
    executionId: 'run',
    nodeId: 'node',
    recipientPrivateKey: keys.privateKey,
  });
  const delivered = JSON.parse(plaintext.toString());
  assert.deepEqual(resolved, ['bunker', 'steadfast']);
  assert.equal(
    delivered.profiles[1].environmentVariable,
    'E2E_STEADFAST_STORAGE_STATE',
  );
  assert.equal(
    delivered.profiles[1].state.origins[0].localStorage[0].value,
    'steadfast-secret',
  );
  assert.throws(() =>
    openAuthenticationEnvelope({
      envelope,
      executionId: 'another-run',
      nodeId: 'node',
      recipientPrivateKey: keys.privateKey,
    }),
  );
});

test('refuses the entire delivery when an additional profile is unavailable', async () => {
  const store = {
    updateMany: async () => ({ count: 1 }),
    findUniqueOrThrow: async () => ({
      ownerUserId: 'owner',
      profiles: [
        { profileId: 'bunker' },
        {
          profileId: 'revoked',
          environmentVariable: 'E2E_STEADFAST_STORAGE_STATE',
        },
      ],
    }),
  } as unknown as ConstructorParameters<
    typeof ExecutionAuthenticationGrants
  >[0];
  const grants = new ExecutionAuthenticationGrants(store, (async (
    _owner: string,
    id: string,
  ) => {
    if (id === 'revoked') throw new Error('Profile revoked');
    return { state: { cookies: [], origins: [] } };
  }) as any);
  await assert.rejects(
    grants.seal({
      executionId: 'run',
      nodeId: 'node',
      recipientPublicKey: 'unused',
    }),
    /Profile revoked/,
  );
});

test('normalizes legacy selections and rejects duplicate or unsafe session mappings', async () => {
  const { normalizeAuthenticationProfiles } =
    await import('../../../runners/shared/authentication-profiles');
  assert.deepEqual(
    normalizeAuthenticationProfiles({ authenticationProfileId: ' legacy ' }),
    [{ profileId: 'legacy' }],
  );
  assert.deepEqual(
    normalizeAuthenticationProfiles({
      authenticationProfileId: 'legacy',
      authenticationProfiles: [],
    }),
    [],
  );
  for (const authenticationProfiles of [
    [{ profileId: 'a' }, { profileId: 'b' }],
    [
      { profileId: 'a' },
      { profileId: 'a', environmentVariable: 'B_STORAGE_STATE' },
    ],
    [
      { profileId: 'a', environmentVariable: 'S_STORAGE_STATE' },
      { profileId: 'b', environmentVariable: 'S_STORAGE_STATE' },
    ],
    [{ profileId: 'a', environmentVariable: 'PATH' }],
    [{ profileId: 'a', environmentVariable: 'PLAYRUNNER_AUTH_STORAGE_STATE' }],
    [{ profileId: '' }],
    'invalid',
    Array.from({ length: 11 }, (_, n) => ({
      profileId: String(n),
      environmentVariable: `P${n}_STORAGE_STATE`,
    })),
  ])
    assert.throws(() =>
      normalizeAuthenticationProfiles({ authenticationProfiles }),
    );
});

test('single unmapped sessions keep the legacy wire format', async () => {
  const { createAuthenticationEnvelopeKeyPair, openAuthenticationEnvelope } =
    await import('../../../runners/shared/authentication-envelope');
  const state = { cookies: [], origins: [] };
  for (const profiles of [null, [{ profileId: 'legacy' }]]) {
    const store = {
      updateMany: async () => ({ count: 1 }),
      findUniqueOrThrow: async () => ({
        ownerUserId: 'owner',
        profileId: 'legacy',
        profiles,
      }),
    } as unknown as ConstructorParameters<
      typeof ExecutionAuthenticationGrants
    >[0];
    const grants = new ExecutionAuthenticationGrants(store, (async () => ({
      state,
    })) as any);
    const keys = createAuthenticationEnvelopeKeyPair();
    const envelope = await grants.seal({
      executionId: 'run',
      nodeId: 'node',
      recipientPublicKey: keys.publicKey,
    });
    assert.deepEqual(
      JSON.parse(
        openAuthenticationEnvelope({
          envelope,
          executionId: 'run',
          nodeId: 'node',
          recipientPrivateKey: keys.privateKey,
        }).toString(),
      ),
      state,
    );
  }
});
