import assert from 'node:assert/strict';
import test from 'node:test';
import { selectExecutionEnvironment } from '../../../runners/shared/execution-environment';
import { parseReleaseRequest } from './release-contract';
import {
  buildReleasePolicy,
  RELEASE_ENVIRONMENT_NODE_ID,
  resolveReleasePolicy,
} from './release-policy';
import { prepareReleaseExecution } from './release-runtime';
import { applyLinkedWorkflowEnvironments } from './workflow-environments';

const secret = {
  key: 'TOKEN',
  id: 'secret-1',
  updatedAt: new Date('2026-10-17T01:00:00Z'),
  value: 'private-test-token',
};
const loadSecrets = async (keys: string[], userId: string) => {
  assert.deepEqual(keys, ['TOKEN']);
  assert.equal(userId, 'owner');
  return [{ ...secret }];
};

const candidate = {
  repository: 'example/app',
  commitSha: 'a'.repeat(40),
  artifactDigest: `sha256:${'b'.repeat(64)}`,
  environment: 'preview',
  targetUrl: 'https://preview.example.test',
};
const workflow = {
  cloudProvider: 'LOCAL_RUNNER',
  nodes: [
    {
      id: 'environment',
      nodeType: 'environment',
      config: { environmentId: 'shared-environment' },
    },
    {
      id: 'checks',
      nodeType: 'playwright',
      config: {
        action: 'run',
        testScript: 'test("checkout", async () => {});',
        envVars: ['BASE_URL', 'MODE'],
      },
    },
    {
      id: 'more-checks',
      nodeType: 'playwright',
      config: { action: 'upload', testSuite: { id: 'suite-1' } },
    },
    {
      id: 'identity',
      nodeType: 'code',
      config: { code: 'return nodes.node_probe;' },
    },
  ],
  connections: [],
  testPlan: {
    name: 'release.md',
    markdown: '# Release checks',
    cases: [
      {
        id: 'CHECKOUT',
        description: 'Checkout',
        criteria: 'Checkout passes',
        tests: [{ nodeId: 'checks', title: 'checkout', project: '' }],
      },
      {
        id: 'RELEASE_IDENTITY',
        description: 'Identity',
        criteria: 'Observed build matches',
        tests: [],
        nodes: ['identity'],
      },
    ],
  },
};

function hydrator(mode = 'live', onCall = () => {}) {
  return async (nodes: unknown, userId: string) => {
    assert.equal(userId, 'owner');
    onCall();
    return applyLinkedWorkflowEnvironments(
      nodes,
      new Map([
        [
          'shared-environment',
          [
            {
              key: 'BASE_URL',
              type: 'default',
              enabled: true,
              currentValue: 'https://stale.example.test',
            },
            { key: 'MODE', type: 'default', enabled: true, currentValue: mode },
            {
              key: 'TOKEN',
              type: 'secret',
              enabled: true,
              currentValue: '********',
            },
            {
              key: 'RELEASE_COMMIT_SHA',
              type: 'default',
              enabled: true,
              currentValue: 'stale-commit',
            },
          ],
        ],
      ]),
    );
  };
}

async function executionBody() {
  const policy = await resolveReleasePolicy(
    workflow,
    'owner',
    hydrator(),
    loadSecrets,
  );
  return {
    ...workflow,
    workflow: { definition: { name: 'Release', testPlan: workflow.testPlan } },
    release: parseReleaseRequest({
      candidate,
      policyVersion: policy.policyVersion,
    }),
  };
}

test('linked environment changes invalidate policy without exposing values', async () => {
  const live = await resolveReleasePolicy(
    workflow,
    'owner',
    hydrator('live'),
    loadSecrets,
  );
  const mocked = await resolveReleasePolicy(
    workflow,
    'owner',
    hydrator('mock'),
    loadSecrets,
  );
  assert.notEqual(live.policyVersion, mocked.policyVersion);
  assert.equal(live.criteriaVersion, mocked.criteriaVersion);
  assert.doesNotMatch(
    JSON.stringify(live),
    /stale.example|TOKEN|\*\*\*|currentValue|variables/,
  );
});

test('release preparation hydrates once and uses the same snapshot for execution', async () => {
  const body = await executionBody();
  let calls = 0;
  const prepared = await prepareReleaseExecution(
    body,
    'owner',
    hydrator('live', () => {
      calls++;
    }),
    loadSecrets,
  );
  assert.equal(calls, 1);
  assert.equal(
    prepared.definition.release?.policyVersion,
    body.release.policyVersion,
  );
  assert.equal(prepared.body.nodes.at(-1).id, RELEASE_ENVIRONMENT_NODE_ID);
  assert.ok(
    !prepared.definition.nodes.some(
      (node) => node.id === RELEASE_ENVIRONMENT_NODE_ID,
    ),
  );
  assert.equal(workflow.nodes.length, 4);

  // Exercise the real shared selector used by local, cloud and paired runners.
  const environment: Record<string, string> = {};
  for (const node of prepared.body.nodes) {
    if (node.nodeType !== 'environment') continue;
    for (const variable of node.config.variables ?? []) {
      if (variable.enabled && variable.key)
        environment[variable.key] =
          variable.currentValue || variable.initialValue || '';
    }
  }
  for (const node of prepared.body.nodes.filter(
    (node) => node.nodeType === 'playwright',
  )) {
    const selected = selectExecutionEnvironment(
      node.config.envVars,
      environment,
    );
    assert.equal(selected.BASE_URL, candidate.targetUrl);
    assert.equal(selected.RELEASE_TARGET_URL, candidate.targetUrl);
    assert.equal(selected.RELEASE_COMMIT_SHA, candidate.commitSha);
    assert.equal(selected.RELEASE_ARTIFACT_DIGEST, candidate.artifactDigest);
    assert.equal(selected.RELEASE_ENVIRONMENT, candidate.environment);
    assert.equal(selected.RELEASE_REPOSITORY, candidate.repository);
    assert.ok(!Object.hasOwn(selected, 'TOKEN'));
  }
  assert.doesNotMatch(
    JSON.stringify(prepared.definition),
    /stale.example|currentValue|\*\*\*|private-test-token/,
  );
});

test('environment changes between policy approval and execution fail closed', async () => {
  const body = await executionBody();
  await assert.rejects(
    prepareReleaseExecution(body, 'owner', hydrator('mock'), loadSecrets),
    /policy has changed/,
  );
});

test('release policies reject AI and unpinned integration nodes only on the release path', () => {
  for (const nodeType of [
    'agent-container',
    'codex-cli',
    'validator',
    'project-memory',
    'openai',
    'github',
    'jira',
  ]) {
    assert.throws(
      () =>
        buildReleasePolicy({
          ...workflow,
          nodes: [...workflow.nodes, { id: 'unsupported', nodeType }],
        }),
      /currently supports only/,
    );
  }
  for (const nodeType of ['code', 'javascript', 'webhooks']) {
    assert.doesNotThrow(() =>
      buildReleasePolicy({
        ...workflow,
        nodes: [...workflow.nodes, { id: 'supported', nodeType }],
      }),
    );
  }
});

test('secret rotation or replacement revokes policy without hashing secret plaintext', async () => {
  const original = await resolveReleasePolicy(
    workflow,
    'owner',
    hydrator(),
    loadSecrets,
  );
  for (const changed of [
    { ...secret, updatedAt: new Date('2026-10-17T01:00:01Z') },
    { ...secret, id: 'replacement-secret' },
  ]) {
    const changedLoader = async () => [changed];
    const updated = await resolveReleasePolicy(
      workflow,
      'owner',
      hydrator(),
      changedLoader,
    );
    assert.notEqual(updated.policyVersion, original.policyVersion);
    await assert.rejects(
      prepareReleaseExecution(
        await executionBody(),
        'owner',
        hydrator(),
        changedLoader,
      ),
      /policy has changed/,
    );
  }
  const differentPlaintext = await resolveReleasePolicy(
    workflow,
    'owner',
    hydrator(),
    async () => [{ ...secret, value: 'other-token' }],
  );
  assert.equal(differentPlaintext.policyVersion, original.policyVersion);
  const plainNodes = (await hydrator()(workflow.nodes, 'owner')) as any[];
  const before = buildReleasePolicy({ ...workflow, nodes: plainNodes }, [
    {
      key: secret.key,
      id: secret.id,
      updatedAt: secret.updatedAt.toISOString(),
    },
  ]);
  plainNodes[0].config.variables.find(
    (variable: any) => variable.key === 'TOKEN',
  ).currentValue = 'plaintext-must-not-be-hashed';
  const after = buildReleasePolicy({ ...workflow, nodes: plainNodes }, [
    {
      key: secret.key,
      id: secret.id,
      updatedAt: secret.updatedAt.toISOString(),
    },
  ]);
  assert.equal(before.policyVersion, after.policyVersion);
  assert.doesNotMatch(
    JSON.stringify(original),
    /TOKEN|secret-1|private-test-token/,
  );
  await assert.rejects(
    resolveReleasePolicy(workflow, 'owner', hydrator(), async () => []),
    /secret is unavailable/,
  );
});

test('execution uses the exact secret record pinned in its snapshot without rereading', async () => {
  let calls = 0;
  const prepared = await prepareReleaseExecution(
    await executionBody(),
    'owner',
    hydrator(),
    async () => {
      calls++;
      return [
        {
          ...secret,
          value: calls === 1 ? 'first-secret-value' : 'later-secret-value',
        },
      ];
    },
  );
  assert.equal(calls, 1);
  const environment = prepared.body.nodes.find(
    (node) => node.id === 'environment',
  );
  const token = environment.config.variables.find(
    (variable: any) => variable.key === 'TOKEN',
  );
  assert.equal(token.currentValue, 'first-secret-value');
  assert.equal(token.initialValue, 'first-secret-value');
  assert.doesNotMatch(
    JSON.stringify(prepared.definition),
    /first-secret-value|later-secret-value/,
  );
});

test('release policies reject mutable test sources and reserved environment node IDs', () => {
  const withConfig = (config: Record<string, unknown>) => ({
    ...workflow,
    nodes: workflow.nodes.map((node) =>
      node.id === 'checks' ? { ...node, config } : node,
    ),
  });
  for (const config of [
    { action: 'clone', repository: 'example/tests', branch: 'main' },
    { repository: 'example/tests' },
    { action: 'workspace' },
  ])
    assert.throws(
      () => buildReleasePolicy(withConfig(config)),
      /pinned|commit SHA/,
    );
  assert.doesNotThrow(() =>
    buildReleasePolicy(
      withConfig({
        action: 'clone',
        repository: 'example/tests',
        branch: 'a'.repeat(40),
      }),
    ),
  );
  assert.doesNotThrow(() =>
    buildReleasePolicy(withConfig({ action: 'run', testScript: 'inline' })),
  );
  assert.doesNotThrow(() =>
    buildReleasePolicy(
      withConfig({ action: 'upload', testSuite: { id: 'suite-1' } }),
    ),
  );
  assert.throws(
    () =>
      buildReleasePolicy({
        ...workflow,
        nodes: [
          ...workflow.nodes,
          { id: RELEASE_ENVIRONMENT_NODE_ID, nodeType: 'environment' },
        ],
      }),
    /reserved/,
  );
});
