import type { WorkflowCiExecution } from '../generated/prisma/client.cts';
import { prisma } from '../lib/prisma';
import type { CiChangeContext } from './ci-change-context';

type ReservationStore = {
  create(params: {
    context: CiChangeContext;
    executionId: string;
    workflowId: string;
  }): Promise<WorkflowCiExecution>;
  find(
    workflowId: string,
    headSha: string,
  ): Promise<WorkflowCiExecution | null>;
};

type RetryReservationStore = {
  executionStatus(executionId: string): Promise<string | null>;
  read(id: string): Promise<WorkflowCiExecution | null>;
  reclaim(params: {
    expectedExecutionId: string;
    expectedStatus: string;
    id: string;
    replacementExecutionId: string;
    staleBefore?: Date;
  }): Promise<boolean>;
};

export const CI_START_RESERVATION_TIMEOUT_MS = 10 * 60 * 1000;

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

const databaseReservationStore: ReservationStore = {
  create: ({ context, executionId, workflowId }) =>
    prisma.workflowCiExecution.create({
      data: {
        ...context,
        executionId,
        workflowId,
      },
    }),
  find: (workflowId, headSha) =>
    prisma.workflowCiExecution.findFirst({
      where: { headSha, workflowId },
    }),
};

const databaseRetryReservationStore: RetryReservationStore = {
  executionStatus: async (executionId) =>
    (
      await prisma.workflowExecution.findUnique({
        select: { status: true },
        where: { id: executionId },
      })
    )?.status ?? null,
  read: (id) => prisma.workflowCiExecution.findUnique({ where: { id } }),
  reclaim: async ({
    expectedExecutionId,
    expectedStatus,
    id,
    replacementExecutionId,
    staleBefore,
  }) =>
    (
      await prisma.workflowCiExecution.updateMany({
        data: {
          executionId: replacementExecutionId,
          failureHttpStatus: null,
          failureMessage: null,
          status: 'starting',
        },
        where: {
          executionId: expectedExecutionId,
          id,
          status: expectedStatus,
          ...(staleBefore ? { updatedAt: { lte: staleBefore } } : {}),
        },
      })
    ).count === 1,
};

const RETRYABLE_EXECUTION_STATUSES = new Set(['cancelled', 'failed']);

export function ciReservationMatchesContext(
  reservation: WorkflowCiExecution,
  context: CiChangeContext,
) {
  return (
    reservation.baseRef === context.baseRef &&
    reservation.baseSha === context.baseSha &&
    reservation.eventType === context.eventType &&
    reservation.headRef === context.headRef &&
    reservation.headSha === context.headSha &&
    reservation.pullRequestNumber === (context.pullRequestNumber ?? null) &&
    reservation.repository === context.repository
  );
}

export async function reserveCiWorkflowExecution(
  params: {
    context: CiChangeContext;
    executionId: string;
    workflowId: string;
  },
  store: ReservationStore = databaseReservationStore,
): Promise<{ created: boolean; reservation: WorkflowCiExecution }> {
  try {
    return { created: true, reservation: await store.create(params) };
  } catch (error) {
    if (!isPrismaUniqueConstraintError(error)) throw error;
    const existing = await store.find(
      params.workflowId,
      params.context.headSha,
    );
    if (!existing) throw error;
    return { created: false, reservation: existing };
  }
}

export async function claimRetryableCiWorkflowExecution(
  reservation: WorkflowCiExecution,
  replacementExecutionId: string,
  options: {
    now?: Date;
    store?: RetryReservationStore;
  } = {},
): Promise<{ claimed: boolean; reservation: WorkflowCiExecution }> {
  const store = options.store ?? databaseRetryReservationStore;
  const executionStatus = await store.executionStatus(reservation.executionId);
  const now = options.now ?? new Date();
  const staleBefore = new Date(now.getTime() - CI_START_RESERVATION_TIMEOUT_MS);

  let requireStaleBefore = false;
  const retryableFailure =
    (reservation.status === 'failed_to_start' && executionStatus === null) ||
    (executionStatus !== null &&
      RETRYABLE_EXECUTION_STATUSES.has(executionStatus));
  if (!retryableFailure) {
    const abandonedStart =
      reservation.status === 'starting' &&
      executionStatus === null &&
      reservation.updatedAt <= staleBefore;
    if (!abandonedStart) return { claimed: false, reservation };
    requireStaleBefore = true;
  }

  const claimed = await store.reclaim({
    expectedExecutionId: reservation.executionId,
    expectedStatus: reservation.status,
    id: reservation.id,
    replacementExecutionId,
    ...(requireStaleBefore ? { staleBefore } : {}),
  });
  const current = await store.read(reservation.id);
  if (!current) {
    throw new Error('CI workflow execution reservation disappeared.');
  }
  return { claimed, reservation: current };
}

export async function markCiWorkflowExecutionRunning(
  id: string,
  executionId: string,
) {
  return prisma.workflowCiExecution.updateMany({
    data: {
      failureHttpStatus: null,
      failureMessage: null,
      status: 'running',
    },
    where: { executionId, id, status: 'starting' },
  });
}

export async function markCiWorkflowExecutionStartFailed(
  id: string,
  executionId: string,
  params: { message: string; status: number },
) {
  return prisma.workflowCiExecution.updateMany({
    data: {
      failureHttpStatus: params.status,
      failureMessage: params.message.slice(0, 500),
      status: 'failed_to_start',
    },
    where: { executionId, id, status: 'starting' },
  });
}

export async function readCiWorkflowExecutionStatus(
  reservation: WorkflowCiExecution,
) {
  const execution = await prisma.workflowExecution.findUnique({
    select: { status: true },
    where: { id: reservation.executionId },
  });
  return execution?.status ?? reservation.status;
}
