import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareExecutionAuthentication } from './prepare-execution-authentication';

const profiles = [
  { profileId: 'bunker', environmentVariable: 'E2E_REGRESSION_STORAGE_STATE' },
  {
    profileId: 'steadfast',
    environmentVariable: 'E2E_STEADFAST_STORAGE_STATE',
  },
];
const args = {
  ownerUserId: 'owner',
  actorUserId: 'owner',
  executionId: 'run',
  nodes: [
    {
      id: 'node',
      nodeType: 'playwright',
      config: { authenticationProfiles: profiles },
    },
    { nodeType: 'environment', config: { environmentId: 'bunker-env' } },
    { nodeType: 'environment', config: { environmentId: 'steadfast-env' } },
  ],
};
function dependencies() {
  const checked: string[] = [];
  const registered: unknown[] = [];
  const audited: unknown[] = [];
  return {
    checked,
    registered,
    audited,
    resolveState: (async (owner: string, profileId: string) => {
      assert.equal(owner, 'owner');
      checked.push(profileId);
      return {
        profile: { environmentId: `${profileId}-env`, name: profileId },
        state: { cookies: [], origins: [] },
      };
    }) as NonNullable<
      Parameters<typeof prepareExecutionAuthentication>[1]
    >['resolveState'],
    register: async (value: unknown) => {
      registered.push(value);
    },
    audit: (async (value: unknown) => {
      audited.push(value);
    }) as any,
  };
}

test('validates and grants both profiles with their own linked Environments', async () => {
  const deps = dependencies();
  assert.deepEqual(await prepareExecutionAuthentication(args, deps), ['node']);
  assert.deepEqual(deps.checked, ['bunker', 'steadfast']);
  assert.deepEqual(deps.registered, [
    { executionId: 'run', nodeId: 'node', ownerUserId: 'owner', profiles },
  ]);
  assert.equal(deps.audited.length, 2);
});

test('rejects a missing second Environment before any grant or success audit', async () => {
  const deps = dependencies();
  await assert.rejects(
    prepareExecutionAuthentication(
      { ...args, nodes: args.nodes.slice(0, 2) },
      deps,
    ),
    { statusCode: 409 },
  );
  assert.deepEqual(deps.registered, []);
  assert.deepEqual(deps.audited, []);
});

test('shared workflow actors cannot use any owner profile', async () => {
  const deps = dependencies();
  await assert.rejects(
    prepareExecutionAuthentication(
      { ...args, actorUserId: 'collaborator' },
      deps,
    ),
    { statusCode: 403 },
  );
  assert.deepEqual(deps.checked, []);
  assert.deepEqual(deps.registered, []);
});

test('invalid mappings fail with a client error before resolving credentials', async () => {
  const deps = dependencies();
  await assert.rejects(
    prepareExecutionAuthentication(
      {
        ...args,
        nodes: [
          {
            id: 'node',
            nodeType: 'playwright',
            config: {
              authenticationProfiles: [{ profileId: 'a' }, { profileId: 'b' }],
            },
          },
        ],
      },
      deps,
    ),
    { statusCode: 400 },
  );
  assert.deepEqual(deps.checked, []);
});

test('legacy nodes still resolve a single profile', async () => {
  const deps = dependencies();
  await prepareExecutionAuthentication(
    {
      ...args,
      nodes: [
        {
          id: 'node',
          nodeType: 'playwright',
          config: { authenticationProfileId: 'bunker' },
        },
        args.nodes[1],
      ],
    },
    deps,
  );
  assert.deepEqual(deps.checked, ['bunker']);
});
