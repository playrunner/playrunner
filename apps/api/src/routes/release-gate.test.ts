import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import type { prisma as PrismaInstance } from '../lib/prisma';
import { runReleaseCli } from '../../../../packages/cli/src/release';

type ExecutionRequest = Parameters<
  typeof import('../runtime').apiRuntime.workflowExecution.execute
>[0];

const owner = 'release-test-owner';
const workflow = {
  id: 'release-workflow',
  userId: owner,
  title: 'Release verification',
  cloudProvider: 'LOCAL_RUNNER',
  concurrency: null,
  nodes: [
    {
      id: 'identity',
      nodeType: 'javascript',
      config: { secret: '{{env.SECRET}}' },
    },
    { id: 'tests', nodeType: 'playwright', config: {} },
  ],
  connections: [],
  testPlan: {
    name: 'release.md',
    markdown: '# Release requirements',
    cases: [
      {
        id: 'RELEASE_IDENTITY',
        description: 'Observed application identity',
        criteria: 'The target serves the exact release candidate',
        tests: [],
        nodes: ['identity'],
      },
      {
        id: 'LOGIN',
        description: 'Login',
        criteria: 'A user can sign in',
        tests: [
          { title: 'user can sign in', project: 'desktop', nodeId: 'tests' },
        ],
      },
    ],
  },
};
test('release machine HTTP routes enforce candidate evidence and token boundaries', async (t) => {
  const unexpectedDatabaseCall = async () => {
    throw new Error('Unexpected database access in release route test.');
  };
  const prisma = {
    apiToken: {
      findUnique: unexpectedDatabaseCall,
      update: unexpectedDatabaseCall,
    },
    apiTokenAudit: { create: unexpectedDatabaseCall },
    workflow: {
      findFirst: unexpectedDatabaseCall,
      findUnique: unexpectedDatabaseCall,
    },
    workflowExecution: {
      findFirst: unexpectedDatabaseCall,
      findUnique: unexpectedDatabaseCall,
    },
    workflowMachineExecution: {
      create: unexpectedDatabaseCall,
      update: unexpectedDatabaseCall,
      findUniqueOrThrow: unexpectedDatabaseCall,
    },
  };
  // The real router and auth middleware share this in-memory Prisma boundary.
  // Import them after injection so no database client or runner can be invoked.
  const previousPrisma = globalThis.prisma;
  globalThis.prisma = prisma as unknown as typeof PrismaInstance;
  t.after(() => {
    globalThis.prisma = previousPrisma;
  });
  const { apiRuntime } = await import('../runtime');
  const { machineExecutionsRouter } = await import('./machine-executions');
  const { captureExecutionDefinition } =
    await import('../services/execution-definition');
  const { buildReleasePolicy } = await import('../services/release-policy');

  const policy = buildReleasePolicy(workflow);
  const release = {
    candidate: {
      repository: 'example/app',
      commitSha: 'a'.repeat(40),
      artifactDigest: `sha256:${'b'.repeat(64)}`,
      environment: 'staging',
      targetUrl: 'https://staging.example.com',
    },
    policyVersion: policy.policyVersion,
    maxAgeSeconds: 600,
  };

  function completedExecution(id = 'release-execution') {
    const completedAt = new Date(Date.now() - 1_000);
    const definition = captureExecutionDefinition({
      ...workflow,
      release,
      workflow: {
        definition: { name: workflow.title, testPlan: workflow.testPlan },
      },
    });
    const event = (
      eventId: number,
      type: string,
      payload: unknown,
      nodeId: string | null = null,
    ) => ({
      id: BigInt(eventId),
      type,
      nodeId,
      payload,
      createdAt: completedAt,
      occurredAt: completedAt,
    });
    return {
      id,
      userId: owner,
      workflowId: workflow.id,
      status: 'completed',
      cloudProvider: 'LOCAL_RUNNER',
      startedAt: new Date(completedAt.getTime() - 10_000),
      completedAt,
      events: [
        event(1, 'execution_definition', definition),
        event(2, 'node_state', { state: 'success' }, 'identity'),
        event(3, 'node_state', { state: 'success' }, 'tests'),
        event(
          4,
          'node_output',
          { output: { releaseCandidate: release.candidate } },
          'identity',
        ),
        event(
          5,
          'node_output',
          {
            output: {
              report: {
                planTests: [
                  {
                    title: 'user can sign in',
                    project: 'desktop',
                    status: 'PASS',
                    evidenceId: 'private-runner-evidence-marker',
                  },
                ],
              },
              secret: 'private-output-marker',
            },
          },
          'tests',
        ),
      ],
    };
  }

  const workflows = new Map([
    [workflow.id, workflow],
    ['other-workflow', { ...workflow, id: 'other-workflow' }],
  ]);
  const passing = completedExecution();
  const historical = completedExecution('historical-execution');
  const historicalDefinition = historical.events[0].payload as Record<
    string,
    unknown
  >;
  delete historicalDefinition.release;
  const executions = new Map([
    [passing.id, passing],
    [historical.id, historical],
  ]);
  const tokens = new Map(
    ['owner', 'other-owner', 'restricted', 'no-execute'].map((name) => {
      const tokenHash = createHash('sha256')
        .update(`pr_live_release-test-${name}`)
        .digest('hex');
      return [
        tokenHash,
        {
          id: `release-token-${name}`,
          userId: name === 'other-owner' ? 'another-owner' : owner,
          tokenHash,
          revokedAt: null,
          expiresAt: null,
          lastUsedAt: new Date(),
          scopes:
            name === 'no-execute' ? ['workflow:write'] : ['workflow:execute'],
          allowedWorkflowIds: name === 'restricted' ? [workflow.id] : [],
        },
      ];
    }),
  );
  t.mock.method(
    prisma.apiToken,
    'findUnique',
    async ({ where }: { where: { tokenHash: string } }) =>
      tokens.get(where.tokenHash) ?? null,
  );
  t.mock.method(prisma.apiToken, 'update', async () => ({}));
  const workflowReads: unknown[] = [];
  t.mock.method(
    prisma.workflow,
    'findFirst',
    async ({ where }: { where: { id: string; userId: string } }) => {
      workflowReads.push(where);
      const found = workflows.get(where.id);
      return found?.userId === where.userId ? found : null;
    },
  );
  const executionReads: unknown[] = [];
  t.mock.method(
    prisma.workflow,
    'findUnique',
    async ({ where }: { where: { id: string } }) =>
      workflows.get(where.id) ?? null,
  );
  t.mock.method(
    prisma.workflowExecution,
    'findFirst',
    async ({
      where,
    }: {
      where: { id: string; userId: string; workflowId: string };
    }) => {
      executionReads.push(where);
      const found = executions.get(where.id);
      return found?.userId === where.userId &&
        found.workflowId === where.workflowId
        ? found
        : null;
    },
  );
  const startCalls: ExecutionRequest[] = [];
  const provision = t.mock.method(
    apiRuntime.runnerProvisioner,
    'start',
    async () => ({ status: 200, body: {} }),
  );
  t.mock.method(
    apiRuntime.workflowExecution,
    'execute',
    async (request: ExecutionRequest) => {
      startCalls.push(request);
      return { status: 202, body: {} };
    },
  );
  t.mock.method(prisma.apiTokenAudit, 'create', async () => ({}));
  type Reservation = {
    id: string;
    apiTokenId: string;
    workflowId: string;
    idempotencyKey: string;
    requestHash: string;
    executionId: string;
    httpStatus: number | null;
    response: unknown;
  };
  const reservations = new Map<string, Reservation>();
  t.mock.method(
    prisma.workflowMachineExecution,
    'create',
    async ({
      data,
    }: {
      data: Omit<Reservation, 'id' | 'httpStatus' | 'response'>;
    }) => {
      if (reservations.has(data.idempotencyKey))
        throw Object.assign(new Error('Duplicate key'), { code: 'P2002' });
      const reservation: Reservation = {
        ...data,
        id: `reservation-${reservations.size}`,
        httpStatus: null,
        response: null,
      };
      reservations.set(data.idempotencyKey, reservation);
      return reservation;
    },
  );
  t.mock.method(
    prisma.workflowMachineExecution,
    'findUniqueOrThrow',
    async ({
      where,
    }: {
      where: {
        apiTokenId_workflowId_idempotencyKey: { idempotencyKey: string };
      };
    }) =>
      reservations.get(
        where.apiTokenId_workflowId_idempotencyKey.idempotencyKey,
      ),
  );
  t.mock.method(
    prisma.workflowMachineExecution,
    'update',
    async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<Reservation>;
    }) => {
      const reservation = [...reservations.values()].find(
        (item) => item.id === where.id,
      )!;
      Object.assign(reservation, data);
      return reservation;
    },
  );
  t.mock.method(prisma.workflowExecution, 'findUnique', async () => null);

  const app = express();
  app.use('/api/v1/workflows', machineExecutionsRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address() as { port: number };
  const request = (
    path: string,
    options: { key?: string; body?: unknown; idempotencyKey?: string } = {},
  ) =>
    fetch(`http://127.0.0.1:${address.port}/api/v1/workflows${path}`, {
      method: options.body === undefined ? 'GET' : 'POST',
      headers: {
        ...(options.key === ''
          ? {}
          : {
              authorization: `Bearer pr_live_release-test-${options.key ?? 'owner'}`,
            }),
        ...(options.body === undefined
          ? {}
          : { 'content-type': 'application/json' }),
        ...(options.idempotencyKey
          ? { 'idempotency-key': options.idempotencyKey }
          : {}),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
  const verdictPath = `/${workflow.id}/executions/${passing.id}/release-verdict`;

  await t.test(
    'policy requires execute permission and exact ownership without leaking other workflows',
    async () => {
      assert.equal(
        (await request(`/${workflow.id}/release-policy`, { key: '' })).status,
        401,
      );
      const allowed = await request(`/${workflow.id}/release-policy`, {
        key: 'restricted',
      });
      assert.equal(allowed.status, 200);
      assert.equal(allowed.headers.get('cache-control'), 'private, no-store');
      assert.deepEqual(await allowed.json(), {
        workflowId: workflow.id,
        ...policy,
      });
      assert.deepEqual(workflowReads.at(-1), {
        id: workflow.id,
        userId: owner,
      });
      const reads = workflowReads.length;
      const restricted = await request('/other-workflow/release-policy', {
        key: 'restricted',
      });
      assert.equal(restricted.status, 404);
      assert.deepEqual(await restricted.json(), {
        error: 'Workflow not found.',
      });
      assert.equal(
        workflowReads.length,
        reads,
        'restricted workflow IDs must not reach a database lookup',
      );
      for (const key of ['other-owner', 'no-execute']) {
        const denied = await request(`/${workflow.id}/release-policy`, { key });
        assert.equal(denied.status, 404);
        assert.deepEqual(await denied.json(), { error: 'Workflow not found.' });
      }
      assert.deepEqual(
        await (await request('/missing-workflow/release-policy')).json(),
        { error: 'Workflow not found.' },
      );
    },
  );

  await t.test(
    'verdict enforces token, workflow and owner boundaries with indistinguishable 404s',
    async () => {
      assert.equal(
        (await request(verdictPath, { key: '', body: release })).status,
        401,
      );
      for (const [path, key] of [
        [verdictPath, 'other-owner'],
        [verdictPath, 'no-execute'],
        [`/other-workflow/executions/${passing.id}/release-verdict`, 'owner'],
        [
          `/other-workflow/executions/${passing.id}/release-verdict`,
          'restricted',
        ],
        [`/${workflow.id}/executions/unknown/release-verdict`, 'owner'],
      ]) {
        const denied = await request(path, { key, body: release });
        assert.equal(denied.status, 404);
        assert.deepEqual(await denied.json(), {
          error: 'Workflow execution not found.',
        });
      }
      assert.ok(
        executionReads.some(
          (where) =>
            JSON.stringify(where) ===
            JSON.stringify({
              id: passing.id,
              workflowId: workflow.id,
              userId: 'another-owner',
            }),
        ),
      );
      assert.ok(
        executionReads.some(
          (where) =>
            JSON.stringify(where) ===
            JSON.stringify({
              id: passing.id,
              workflowId: 'other-workflow',
              userId: owner,
            }),
        ),
      );
    },
  );

  await t.test(
    'stored passing evidence returns PASS and historical runs remain BLOCKED',
    async () => {
      const response = await request(verdictPath, {
        key: 'restricted',
        body: release,
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      const verdict = await response.json();
      assert.equal(verdict.status, 'PASS');
      assert.equal(verdict.allowed, true);
      assert.equal(verdict.executionId, passing.id);
      assert.equal(verdict.workflowId, workflow.id);
      assert.equal(verdict.policyVersion, policy.policyVersion);
      assert.equal(verdict.criteriaVersion, policy.criteriaVersion);
      assert.deepEqual(verdict.candidate, release.candidate);
      assert.deepEqual(verdict.reasons, []);
      assert.deepEqual(executionReads.at(-1), {
        id: passing.id,
        workflowId: workflow.id,
        userId: owner,
      });
      assert.equal(
        JSON.stringify(verdict).includes('private-output-marker'),
        false,
      );
      assert.equal(
        JSON.stringify(verdict).includes('private-runner-evidence-marker'),
        false,
      );
      const old = await request(
        `/${workflow.id}/executions/${historical.id}/release-verdict`,
        { body: release },
      );
      assert.equal(old.status, 200);
      const blocked = await old.json();
      assert.equal(blocked.status, 'BLOCKED');
      assert.equal(blocked.allowed, false);
      assert.ok(
        blocked.reasons.some(
          (reason: { code: string }) =>
            reason.code === 'MISSING_RELEASE_CONTEXT',
        ),
      );
    },
  );

  await t.test(
    'malformed candidate and caller-supplied evidence fail before evidence lookup',
    async () => {
      const reads = executionReads.length;
      for (const body of [
        {
          ...release,
          candidate: { ...release.candidate, commitSha: 'abc123' },
        },
        {
          ...release,
          candidate: {
            ...release.candidate,
            targetUrl: 'https://user:password@example.com',
          },
        },
        { ...release, observedCandidate: release.candidate },
        { ...release, policyVersion: 'latest' },
      ])
        assert.equal((await request(verdictPath, { body })).status, 400);
      assert.equal(executionReads.length, reads);
    },
  );

  await t.test(
    'release starts preserve identity and changing candidate cannot reuse an idempotency key',
    async () => {
      const response = await request(`/${workflow.id}/executions`, {
        body: { release },
        idempotencyKey: 'release-start',
      });
      assert.equal(response.status, 202);
      const started = await response.json();
      assert.equal(startCalls.length, 1);
      assert.equal(provision.mock.callCount(), 1);
      assert.equal(startCalls[0].resourceOwnerUserId, owner);
      assert.equal(startCalls[0].testId, started.executionId);
      assert.deepEqual(startCalls[0].body.release, release);
      assert.deepEqual(startCalls[0].body.inputs, {
        PLAYRUNNER_RELEASE_REPOSITORY: release.candidate.repository,
        PLAYRUNNER_RELEASE_COMMIT_SHA: release.candidate.commitSha,
        PLAYRUNNER_RELEASE_ARTIFACT_DIGEST: release.candidate.artifactDigest,
        PLAYRUNNER_RELEASE_ENVIRONMENT: release.candidate.environment,
        PLAYRUNNER_RELEASE_TARGET_URL: release.candidate.targetUrl,
      });
      assert.deepEqual(captureExecutionDefinition(startCalls[0].body).release, {
        ...release,
        criteriaVersion: policy.criteriaVersion,
        identityNodeId: 'identity',
      });
      const replay = await request(`/${workflow.id}/executions`, {
        body: { release },
        idempotencyKey: 'release-start',
      });
      assert.equal(replay.status, 202);
      assert.equal((await replay.json()).deduplicated, true);
      const mismatch = await request(`/${workflow.id}/executions`, {
        body: {
          release: {
            ...release,
            candidate: {
              ...release.candidate,
              artifactDigest: `sha256:${'d'.repeat(64)}`,
            },
          },
        },
        idempotencyKey: 'release-start',
      });
      assert.equal(mismatch.status, 409);
      assert.equal(startCalls.length, 1);
      assert.equal(provision.mock.callCount(), 1);
    },
  );

  await t.test(
    'legacy CI context, ad hoc criteria and reserved identity inputs are rejected before dispatch',
    async () => {
      const started = startCalls.length;
      const provisioned = provision.mock.callCount();
      for (const body of [
        {
          release,
          repository: { owner: 'example', name: 'app' },
          headSha: 'a'.repeat(40),
        },
        { release, acceptanceCriteria: ['A caller cannot replace the policy'] },
        { release, inputs: { PLAYRUNNER_RELEASE_COMMIT_SHA: 'f'.repeat(40) } },
        { release, inputs: { MODE: 'skip-login' } },
        { release: { ...release, policyVersion: 'f'.repeat(64) } },
      ])
        assert.equal(
          (await request(`/${workflow.id}/executions`, { body })).status,
          400,
        );
      assert.equal(startCalls.length, started);
      assert.equal(provision.mock.callCount(), provisioned);
    },
  );

  await t.test(
    'the real release CLI permits a guarded deployment only for fresh matching stored evidence',
    async (caseContext) => {
      const directory = await mkdtemp(
        path.join(tmpdir(), 'playrunner-release-route-'),
      );
      caseContext.after(() => rm(directory, { recursive: true, force: true }));
      const manifestPath = path.join(directory, 'candidate.json');
      const mismatchPath = path.join(directory, 'different-candidate.json');
      await writeFile(manifestPath, JSON.stringify(release.candidate));
      await writeFile(
        mismatchPath,
        JSON.stringify({
          ...release.candidate,
          artifactDigest: `sha256:${'e'.repeat(64)}`,
        }),
      );
      const expired = completedExecution('expired-execution');
      expired.startedAt = new Date(Date.now() - 3_700_000);
      expired.completedAt = new Date(Date.now() - 3_600_000);
      executions.set(expired.id, expired);
      const deploy = caseContext.mock.fn(() => undefined);
      const checkThenDeploy = async (
        executionId: string,
        candidatePath = manifestPath,
      ) => {
        const stdout: string[] = [];
        const stderr: string[] = [];
        // Exercise the real manifest reader, HTTP client, API router and verdict
        // consumer. Only a zero CLI exit permits the simulated deployment step.
        const exitCode = await runReleaseCli(
          [
            'check',
            workflow.id,
            '--execution',
            executionId,
            '--candidate',
            candidatePath,
            '--policy-version',
            release.policyVersion,
            '--max-age',
            String(release.maxAgeSeconds),
            '--json',
          ],
          {
            env: {
              PLAYRUNNER_URL: `http://127.0.0.1:${address.port}`,
              PLAYRUNNER_API_KEY: 'pr_live_release-test-restricted',
            },
            stdout: (line) => stdout.push(line),
            stderr: (line) => stderr.push(line),
          },
        );
        if (exitCode === 0) deploy();
        return { exitCode, stdout, stderr };
      };
      const allowed = await checkThenDeploy(passing.id);
      assert.equal(allowed.exitCode, 0, allowed.stderr.join('\n'));
      assert.equal(JSON.parse(allowed.stdout[0]).status, 'PASS');
      assert.equal(deploy.mock.callCount(), 1);
      for (const [executionId, candidatePath, reason] of [
        [passing.id, mismatchPath, 'CANDIDATE_MISMATCH'],
        [historical.id, manifestPath, 'MISSING_RELEASE_CONTEXT'],
        [expired.id, manifestPath, 'EVIDENCE_EXPIRED'],
      ]) {
        const denied = await checkThenDeploy(executionId, candidatePath);
        assert.equal(denied.exitCode, 1, denied.stderr.join('\n'));
        const verdict = JSON.parse(denied.stdout[0]);
        assert.equal(verdict.allowed, false);
        assert.ok(
          verdict.reasons.some(
            (item: { code: string }) => item.code === reason,
          ),
        );
        assert.equal(
          deploy.mock.callCount(),
          1,
          'a blocked release must never reach the deployment step',
        );
      }
    },
  );

  await t.test(
    'changing or deleting the saved release policy invalidates an earlier passing execution',
    async () => {
      workflows.set(workflow.id, {
        ...workflow,
        testPlan: {
          ...workflow.testPlan,
          markdown: '# Changed release requirements',
        },
      });
      try {
        const changed = await request(verdictPath, { body: release });
        assert.equal(changed.status, 200);
        const changedVerdict = await changed.json();
        assert.equal(changedVerdict.status, 'BLOCKED');
        assert.equal(changedVerdict.allowed, false);
        assert.ok(
          changedVerdict.reasons.some(
            (reason: { code: string }) =>
              reason.code === 'CURRENT_POLICY_CHANGED',
          ),
        );
        workflows.delete(workflow.id);
        const deleted = await request(verdictPath, { body: release });
        // A removed policy must never leave a releasable historical approval.
        assert.equal(deleted.status, 200);
        const deletedVerdict = await deleted.json();
        assert.equal(deletedVerdict.status, 'BLOCKED');
        assert.equal(deletedVerdict.allowed, false);
        assert.ok(
          deletedVerdict.reasons.some(
            (reason: { code: string }) =>
              reason.code === 'CURRENT_POLICY_CHANGED',
          ),
        );
      } finally {
        workflows.set(workflow.id, workflow);
      }
    },
  );
});
