import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowCiExecution } from '../generated/prisma/client.cts';
import {
  CI_START_RESERVATION_TIMEOUT_MS,
  claimRetryableCiWorkflowExecution,
  ciReservationMatchesContext,
  reserveCiWorkflowExecution,
} from './ci-workflow-executions';

const context = {
  baseRef: 'main',
  baseSha: 'a'.repeat(40),
  eventType: 'push' as const,
  headRef: 'main',
  headSha: 'b'.repeat(40),
  repository: 'playrunner/playrunner',
};

function reservation(): WorkflowCiExecution {
  return {
    ...context,
    createdAt: new Date('2026-08-21T00:00:00.000Z'),
    executionId: 'execution-existing',
    failureHttpStatus: null,
    failureMessage: null,
    id: 'reservation-existing',
    pullRequestNumber: null,
    status: 'running',
    updatedAt: new Date('2026-08-21T00:00:00.000Z'),
    workflowId: 'workflow-1',
  };
}

test('atomically creates the workflow and head SHA idempotency reservation', async () => {
  const existing = reservation();
  let creates = 0;
  const result = await reserveCiWorkflowExecution(
    {
      context,
      executionId: 'execution-new',
      workflowId: 'workflow-1',
    },
    {
      create: async () => {
        creates += 1;
        return { ...existing, executionId: 'execution-new' };
      },
      find: async () => null,
    },
  );

  assert.equal(creates, 1);
  assert.equal(result.created, true);
  assert.equal(result.reservation.executionId, 'execution-new');
});

test('returns the winner after a concurrent unique constraint conflict', async () => {
  const existing = reservation();
  const result = await reserveCiWorkflowExecution(
    {
      context,
      executionId: 'execution-loser',
      workflowId: 'workflow-1',
    },
    {
      create: async () => {
        throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      },
      find: async (workflowId, headSha) => {
        assert.equal(workflowId, 'workflow-1');
        assert.equal(headSha, context.headSha);
        return existing;
      },
    },
  );

  assert.equal(result.created, false);
  assert.equal(result.reservation.executionId, 'execution-existing');
});

test('does not hide unrelated database failures', async () => {
  await assert.rejects(
    reserveCiWorkflowExecution(
      {
        context,
        executionId: 'execution-new',
        workflowId: 'workflow-1',
      },
      {
        create: async () => {
          throw Object.assign(new Error('Database unavailable'), {
            code: 'P1001',
          });
        },
        find: async () => null,
      },
    ),
    /Database unavailable/,
  );
});

test('detects a conflicting context that reuses the workflow and head SHA key', () => {
  assert.equal(ciReservationMatchesContext(reservation(), context), true);
  assert.equal(
    ciReservationMatchesContext(reservation(), {
      ...context,
      baseSha: 'c'.repeat(40),
    }),
    false,
  );
});

test('reclaims an abandoned starting reservation after its bounded lease', async () => {
  const existing = {
    ...reservation(),
    status: 'starting',
    updatedAt: new Date('2026-08-21T00:00:00.000Z'),
  };
  let reclaimed = false;
  const result = await claimRetryableCiWorkflowExecution(
    existing,
    'execution-recovered',
    {
      now: new Date(
        existing.updatedAt.getTime() + CI_START_RESERVATION_TIMEOUT_MS + 1,
      ),
      store: {
        executionStatus: async () => null,
        read: async () =>
          reclaimed
            ? {
                ...existing,
                executionId: 'execution-recovered',
                status: 'starting',
              }
            : null,
        reclaim: async ({ replacementExecutionId, staleBefore }) => {
          assert.equal(replacementExecutionId, 'execution-recovered');
          assert.ok(staleBefore);
          reclaimed = true;
          return true;
        },
      },
    },
  );

  assert.equal(reclaimed, true);
  assert.equal(result.claimed, true);
  assert.equal(result.reservation.executionId, 'execution-recovered');
});

test('does not reclaim an active reservation or one with an execution', async () => {
  const existing = {
    ...reservation(),
    status: 'starting',
    updatedAt: new Date('2026-08-21T00:00:00.000Z'),
  };
  let reclaimCalls = 0;
  const store = {
    executionStatus: async () => 'running',
    read: async () => existing,
    reclaim: async () => {
      reclaimCalls += 1;
      return true;
    },
  };
  assert.deepEqual(
    await claimRetryableCiWorkflowExecution(existing, 'execution-recovered', {
      now: new Date('2026-08-22T00:00:00.000Z'),
      store,
    }),
    { claimed: false, reservation: existing },
  );
  assert.equal(reclaimCalls, 0);
});

test('atomically retries a failed-to-start reservation without an execution', async () => {
  const existing = {
    ...reservation(),
    failureHttpStatus: 502,
    failureMessage: 'Runner unavailable.',
    status: 'failed_to_start',
  };
  let current = existing;
  const result = await claimRetryableCiWorkflowExecution(
    existing,
    'execution-retry',
    {
      store: {
        executionStatus: async () => null,
        read: async () => current,
        reclaim: async (params) => {
          assert.equal(params.expectedExecutionId, 'execution-existing');
          assert.equal(params.expectedStatus, 'failed_to_start');
          assert.equal(params.staleBefore, undefined);
          current = {
            ...current,
            executionId: params.replacementExecutionId,
            failureHttpStatus: null,
            failureMessage: null,
            status: 'starting',
          };
          return true;
        },
      },
    },
  );

  assert.equal(result.claimed, true);
  assert.equal(result.reservation.executionId, 'execution-retry');
  assert.equal(result.reservation.status, 'starting');
  assert.equal(result.reservation.failureHttpStatus, null);
  assert.equal(result.reservation.failureMessage, null);
});

test('does not retry an ambiguously accepted start while its execution is running', async () => {
  const existing = {
    ...reservation(),
    failureHttpStatus: 502,
    failureMessage: 'Invocation response was lost.',
    status: 'failed_to_start',
  };
  let reclaimCalls = 0;
  const result = await claimRetryableCiWorkflowExecution(
    existing,
    'execution-unsafe-retry',
    {
      store: {
        executionStatus: async () => 'running',
        read: async () => existing,
        reclaim: async () => {
          reclaimCalls += 1;
          return true;
        },
      },
    },
  );

  assert.deepEqual(result, { claimed: false, reservation: existing });
  assert.equal(reclaimCalls, 0);
});

test('retries a terminal failed execution but reuses a completed execution', async () => {
  const existing = reservation();
  let current = existing;
  const failed = await claimRetryableCiWorkflowExecution(
    existing,
    'execution-after-failure',
    {
      store: {
        executionStatus: async () => 'failed',
        read: async () => current,
        reclaim: async ({ replacementExecutionId }) => {
          current = {
            ...current,
            executionId: replacementExecutionId,
            status: 'starting',
          };
          return true;
        },
      },
    },
  );
  assert.equal(failed.claimed, true);
  assert.equal(failed.reservation.executionId, 'execution-after-failure');

  let completedReclaimCalls = 0;
  const completed = await claimRetryableCiWorkflowExecution(
    existing,
    'execution-after-completion',
    {
      store: {
        executionStatus: async () => 'completed',
        read: async () => existing,
        reclaim: async () => {
          completedReclaimCalls += 1;
          return true;
        },
      },
    },
  );
  assert.equal(completed.claimed, false);
  assert.equal(completed.reservation.executionId, 'execution-existing');
  assert.equal(completedReclaimCalls, 0);
});

test('only one concurrent request claims a failed execution retry', async () => {
  const existing = reservation();
  let current = existing;
  const store = {
    executionStatus: async (executionId: string) =>
      executionId === existing.executionId ? 'failed' : null,
    read: async () => current,
    reclaim: async ({
      expectedExecutionId,
      expectedStatus,
      replacementExecutionId,
    }: {
      expectedExecutionId: string;
      expectedStatus: string;
      replacementExecutionId: string;
    }) => {
      if (
        current.executionId !== expectedExecutionId ||
        current.status !== expectedStatus
      ) {
        return false;
      }
      current = {
        ...current,
        executionId: replacementExecutionId,
        status: 'starting',
      };
      return true;
    },
  };

  const claims = await Promise.all([
    claimRetryableCiWorkflowExecution(existing, 'execution-retry-a', {
      store,
    }),
    claimRetryableCiWorkflowExecution(existing, 'execution-retry-b', {
      store,
    }),
  ]);

  assert.equal(claims.filter((claim) => claim.claimed).length, 1);
  assert.equal(
    new Set(claims.map((claim) => claim.reservation.executionId)).size,
    1,
  );
  assert.match(claims[0].reservation.executionId, /^execution-retry-[ab]$/);
});
