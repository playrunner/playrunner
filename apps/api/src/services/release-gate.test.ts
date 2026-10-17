import assert from 'node:assert/strict';
import test from 'node:test';
import { captureExecutionDefinition } from './execution-definition';
import { executionEvents } from './execution-events';
import { machineRunRequestHash } from './machine-run-idempotency';
import { parseReleaseCandidate, parseReleaseRequest } from './release-contract';
import { buildReleasePolicy } from './release-policy';
import { buildReleaseVerdict } from './release-gate';

const now = Date.UTC(2026, 9, 17, 2);
const candidate = {
  repository: 'example/app',
  commitSha: 'a'.repeat(40),
  artifactDigest: `sha256:${'b'.repeat(64)}`,
  environment: 'release-preview',
  targetUrl: 'https://preview.example.test',
};
const workflow = {
  cloudProvider: 'LOCAL_RUNNER',
  concurrency: null,
  nodes: [
    {
      id: 'checks',
      nodeType: 'playwright',
      config: { code: 'assert checkout works' },
    },
    {
      id: 'identity',
      nodeType: 'javascript',
      config: { code: 'read deployed identity' },
    },
  ],
  connections: [{ sourceId: 'checks', targetId: 'identity' }],
  testPlan: {
    name: 'release.md',
    markdown: '# Release requirements',
    cases: [
      {
        id: 'CHECKOUT',
        description: 'Checkout',
        criteria: 'Checkout succeeds',
        tests: [
          { nodeId: 'checks', title: 'checkout succeeds', project: 'desktop' },
        ],
      },
      {
        id: 'RELEASE_IDENTITY',
        description: 'Application build',
        criteria: 'Target reports the candidate build',
        tests: [],
        nodes: ['identity'],
      },
    ],
  },
};
const policy = buildReleasePolicy(workflow);
const expected = parseReleaseRequest({
  candidate,
  policyVersion: policy.policyVersion,
});
const definition = captureExecutionDefinition({
  ...workflow,
  workflow: { definition: { name: 'Release', testPlan: workflow.testPlan } },
  release: expected,
});
const event = (
  id: number,
  type: string,
  payload: unknown,
  nodeId: string | null = null,
) => ({
  id: BigInt(id),
  type,
  payload,
  nodeId,
  createdAt: new Date(now - 30000),
  occurredAt: new Date(now - 30000),
});
function run() {
  return {
    id: 'execution-1',
    workflowId: 'workflow-1',
    status: 'completed',
    cloudProvider: 'LOCAL_RUNNER',
    startedAt: new Date(now - 60000),
    completedAt: new Date(now - 10000),
    events: [
      event(1, 'execution_definition', structuredClone(definition)),
      event(2, 'node_state', { state: 'success' }, 'checks'),
      event(3, 'node_state', { state: 'success' }, 'identity'),
      event(
        4,
        'node_output',
        {
          output: {
            report: {
              planTests: [
                {
                  title: 'checkout succeeds',
                  project: 'desktop',
                  status: 'PASS',
                  evidenceId: 'arbitrary runner data must not leak',
                },
              ],
            },
          },
        },
        'checks',
      ),
      event(
        5,
        'node_output',
        {
          output: {
            releaseCandidate: candidate,
            privateValue: 'not for machine API',
          },
        },
        'identity',
      ),
    ],
  };
}
const codes = (
  execution: ReturnType<typeof run>,
  request = expected,
  at = now,
) => buildReleaseVerdict(execution, request, at).reasons.map((r) => r.code);

test('a release passes only with matching captured policy, observed identity and all requirements', () => {
  const verdict = buildReleaseVerdict(run(), expected, now);
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.status, 'PASS');
  assert.equal(verdict.criteriaVersion, policy.criteriaVersion);
  assert.equal(verdict.requirements.length, 2);
  assert.equal(
    verdict.expiresAt,
    new Date(now - 60000 + 3600000).toISOString(),
  );
  assert.deepEqual(verdict.reasons, []);
  assert.doesNotMatch(
    JSON.stringify(verdict),
    /arbitrary runner data|privateValue|not for machine|Release requirements/,
  );
});

test('completed workflows without evidence or release snapshots cannot pass', () => {
  const empty = run();
  empty.events = [empty.events[0]];
  assert.equal(buildReleaseVerdict(empty, expected, now).allowed, false);
  assert.ok(codes(empty).includes('MISSING_OBSERVED_IDENTITY'));
  const old = run();
  delete (old.events[0].payload as typeof definition).release;
  assert.ok(codes(old).includes('MISSING_RELEASE_CONTEXT'));
  const duplicate = run();
  duplicate.events.push(duplicate.events[0]);
  assert.ok(codes(duplicate).includes('INVALID_EXECUTION_SNAPSHOT'));
});

test('each candidate dimension is bound to both the request snapshot and observed build', () => {
  for (const [key, value] of Object.entries({
    repository: 'example/other',
    commitSha: 'c'.repeat(40),
    artifactDigest: `sha256:${'d'.repeat(64)}`,
    environment: 'production',
    targetUrl: 'https://other.example.test',
  })) {
    const request = { ...expected, candidate: { ...candidate, [key]: value } };
    assert.ok(codes(run(), request).includes('CANDIDATE_MISMATCH'), key);
    const wrong = run();
    wrong.events[4] = event(
      5,
      'node_output',
      { output: { releaseCandidate: request.candidate } },
      'identity',
    );
    assert.ok(codes(wrong).includes('OBSERVED_IDENTITY_MISMATCH'), key);
  }
});

test('identity must come from the pinned required node and cannot be repaired by a later matching observation', () => {
  const wrongNode = run();
  wrongNode.events[4].nodeId = 'checks';
  assert.ok(codes(wrongNode).includes('MISSING_OBSERVED_IDENTITY'));
  const changed = run();
  changed.events.push(
    event(
      6,
      'node_output',
      {
        output: {
          releaseCandidate: { ...candidate, commitSha: 'c'.repeat(40) },
        },
      },
      'identity',
    ),
  );
  changed.events.push(
    event(
      7,
      'node_output',
      { output: { releaseCandidate: candidate } },
      'identity',
    ),
  );
  assert.equal(buildReleaseVerdict(changed, expected, now).allowed, false);
});

test('failed, skipped, missing, ambiguous and runner-error results block a release', () => {
  for (const status of ['FAIL', 'SKIPPED', 'BLOCKED', 'NOT RUN']) {
    const execution = run();
    const payload = execution.events[3].payload as any;
    payload.output.report.planTests[0].status = status;
    const result = buildReleaseVerdict(execution, expected, now);
    assert.equal(result.allowed, false, status);
    assert.equal(result.status, status === 'FAIL' ? 'FAIL' : 'BLOCKED');
  }
  const missing = run();
  missing.events.splice(3, 1);
  assert.ok(codes(missing).includes('REQUIREMENTS_NOT_PASSED'));
  const ambiguous = run();
  const tests = (ambiguous.events[3].payload as any).output.report.planTests;
  tests.push({ ...tests[0] });
  assert.equal(buildReleaseVerdict(ambiguous, expected, now).allowed, false);
  const globalError = run();
  (globalError.events[3].payload as any).output.report.errors = [
    'private error',
  ];
  assert.equal(buildReleaseVerdict(globalError, expected, now).allowed, false);
});

test('non-completed lifecycle and conflicting terminal events cannot pass', () => {
  for (const status of ['running', 'failed', 'cancelled', 'failed_to_start']) {
    assert.equal(
      buildReleaseVerdict({ ...run(), status }, expected, now).allowed,
      false,
      status,
    );
  }
  const contradictory = run();
  contradictory.events.push(event(6, 'workflow_failed', {}));
  assert.equal(
    buildReleaseVerdict(contradictory, expected, now).allowed,
    false,
  );
});

test('evidence expires from run start and a request cannot extend the captured TTL', () => {
  assert.ok(codes(run(), expected, now + 3540000).includes('EVIDENCE_EXPIRED'));
  assert.ok(
    codes(run(), { ...expected, maxAgeSeconds: 86400 }, now + 3540000).includes(
      'EVIDENCE_EXPIRED',
    ),
  );
  assert.ok(
    codes(run(), { ...expected, maxAgeSeconds: 60 }).includes(
      'EVIDENCE_EXPIRED',
    ),
  );
  assert.ok(
    codes({ ...run(), completedAt: null } as any).includes(
      'INVALID_EVIDENCE_TIME',
    ),
  );
  assert.ok(
    codes({ ...run(), completedAt: new Date(now + 1) }).includes(
      'INVALID_EVIDENCE_TIME',
    ),
  );
});

test('policy pins code, graph and criteria while canonical object key order is stable', () => {
  assert.equal(
    buildReleasePolicy({
      ...workflow,
      nodes: workflow.nodes.map((n) => ({
        config: n.config,
        nodeType: n.nodeType,
        id: n.id,
      })),
    }).policyVersion,
    policy.policyVersion,
  );
  for (const variant of [
    { ...workflow, connections: [] },
    {
      ...workflow,
      nodes: workflow.nodes.map((n) => ({
        ...n,
        config: { code: 'weakened check' },
      })),
    },
    {
      ...workflow,
      testPlan: { ...workflow.testPlan, markdown: '# New requirements' },
    },
  ])
    assert.notEqual(
      buildReleasePolicy(variant).policyVersion,
      policy.policyVersion,
    );
  const wrongPolicy = { ...expected, policyVersion: 'f'.repeat(64) };
  assert.ok(codes(run(), wrongPolicy).includes('POLICY_MISMATCH'));
  assert.throws(
    () =>
      captureExecutionDefinition({
        ...workflow,
        workflow: { definition: { testPlan: workflow.testPlan } },
        release: wrongPolicy,
      }),
    /policy has changed/,
  );
  const changed = run();
  (changed.events[0].payload as typeof definition).testPlan!.markdown =
    '# Mutated plan';
  assert.ok(codes(changed).includes('CRITERIA_MISMATCH'));
});

test('release policy requires explicit identity and executable mappings', () => {
  assert.throws(
    () => buildReleasePolicy({ ...workflow, testPlan: undefined }),
    /saved test plan/,
  );
  assert.throws(
    () =>
      buildReleasePolicy({
        ...workflow,
        testPlan: {
          ...workflow.testPlan,
          cases: workflow.testPlan.cases.slice(0, 1),
        },
      }),
    /RELEASE_IDENTITY/,
  );
  assert.throws(
    () =>
      buildReleasePolicy({
        ...workflow,
        testPlan: {
          ...workflow.testPlan,
          cases: workflow.testPlan.cases.slice(1),
        },
      }),
    /in addition/,
  );
  assert.throws(
    () => buildReleasePolicy({ ...workflow, nodes: [] }),
    /saved workflow nodes/,
  );
});

test('release inputs reject mutable refs, unbounded ages, credentials and unknown fields', () => {
  for (const invalid of [
    { ...candidate, commitSha: 'main' },
    { ...candidate, artifactDigest: 'latest' },
    { ...candidate, targetUrl: 'https://user:secret@example.test' },
    { ...candidate, targetUrl: 'https://example.test/?token=secret' },
    { ...candidate, targetUrl: 'file:///tmp/app' },
    { ...candidate, observed: true },
  ])
    assert.throws(() => parseReleaseCandidate(invalid));
  for (const maxAgeSeconds of [0, -1, 86401, 1.5, '3600'])
    assert.throws(() => parseReleaseRequest({ ...expected, maxAgeSeconds }));
  assert.throws(() => parseReleaseRequest({ ...expected, allowed: true }));
});

test('idempotency binds candidate and policy and runner events cannot replace a server snapshot', async () => {
  assert.notEqual(
    machineRunRequestHash({}, [], expected),
    machineRunRequestHash({}, [], {
      ...expected,
      candidate: { ...candidate, environment: 'production' },
    }),
  );
  assert.notEqual(
    machineRunRequestHash({}, [], expected),
    machineRunRequestHash({}, [], {
      ...expected,
      policyVersion: 'e'.repeat(64),
    }),
  );
  await assert.rejects(
    executionEvents.appendEvent('unused', { type: 'execution_definition' }),
    /only be created by the server/,
  );
});
