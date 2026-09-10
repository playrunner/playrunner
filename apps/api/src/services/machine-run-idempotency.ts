import crypto from 'node:crypto';
import { prisma } from '../lib/prisma';
import type { Prisma } from '../generated/prisma/client.cts';

type RunResponse = { status: number; body: Record<string, unknown> };

export function parseMachineIdempotencyKey(value: string | undefined) {
  if (value === undefined) return undefined;
  const key = value.trim();
  if (!key || key.length > 200) {
    throw new Error('Idempotency-Key must be a string of 1-200 characters.');
  }
  return key;
}

export function machineRunRequestHash(
  inputs: Record<string, string>,
  acceptanceCriteria: string[],
) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        inputs: Object.entries(inputs).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
        acceptanceCriteria,
      }),
    )
    .digest('hex');
}

export async function executeIdempotentMachineRun(
  params: {
    apiTokenId: string;
    workflowId: string;
    idempotencyKey?: string;
    requestHash: string;
    start: (executionId: string) => Promise<RunResponse>;
  },
  database = prisma,
): Promise<RunResponse> {
  const executionId = crypto.randomUUID();
  if (!params.idempotencyKey) return params.start(executionId);
  const key = {
    apiTokenId: params.apiTokenId,
    workflowId: params.workflowId,
    idempotencyKey: params.idempotencyKey,
  };
  let reservation;
  try {
    reservation = await database.workflowMachineExecution.create({
      data: { ...key, requestHash: params.requestHash, executionId },
    });
  } catch (error) {
    if (
      !(
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      )
    )
      throw error;
    const existing = await database.workflowMachineExecution.findUniqueOrThrow({
      where: { apiTokenId_workflowId_idempotencyKey: key },
    });
    if (existing.requestHash !== params.requestHash)
      return {
        status: 409,
        body: {
          error: 'This idempotency key already uses different workflow inputs.',
        },
      };
    const execution = await database.workflowExecution.findUnique({
      where: { id: existing.executionId },
      select: { status: true },
    });
    // An accepted execution is authoritative even if the response was lost.
    if (execution || existing.httpStatus === null)
      return {
        status: 202,
        body: {
          executionId: existing.executionId,
          workflowId: params.workflowId,
          status: execution?.status ?? 'starting',
          deduplicated: true,
        },
      };
    return {
      status: existing.httpStatus,
      body: {
        ...(existing.response as Record<string, unknown>),
        deduplicated: true,
      },
    };
  }
  let response: RunResponse;
  try {
    response = await params.start(executionId);
  } catch (error) {
    console.error(
      'Failed to start idempotent machine workflow execution:',
      error,
    );
    response = {
      status: 500,
      body: {
        error: 'Workflow could not be started.',
        executionId,
        workflowId: params.workflowId,
        status: 'failed_to_start',
      },
    };
  }
  // Never release a reservation on failure: dispatch may have succeeded.
  await database.workflowMachineExecution.update({
    where: { id: reservation.id },
    data: {
      httpStatus: response.status,
      response: response.body as Prisma.InputJsonValue,
    },
  });
  return response;
}
