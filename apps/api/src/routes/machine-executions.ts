import crypto from 'node:crypto';
import express, { Router, type ErrorRequestHandler } from 'express';
import { requireApiToken } from '../auth/api-token.middleware';
import { prisma } from '../lib/prisma';
import {
  executionEvents,
  sanitizeWorkflowLogMessage,
} from '../services/execution-events';
import { apiTokens, tokenCanExecuteWorkflow } from '../services/api-tokens';
import { loadAgentMemoryByNodeId } from '../services/agent-memory';
import {
  CiChangeContextValidationError,
  MAX_CI_CHANGE_CONTEXT_BYTES,
  parseCiChangeContext,
} from '../services/ci-change-context';
import {
  claimRetryableCiWorkflowExecution,
  ciReservationMatchesContext,
  markCiWorkflowExecutionRunning,
  markCiWorkflowExecutionStartFailed,
  readCiWorkflowExecutionStatus,
  reserveCiWorkflowExecution,
} from '../services/ci-workflow-executions';
import { executeSavedWorkflow } from '../services/saved-workflow-execution';
import { machineExecutionCiPolicyError } from '../services/execution-trust-boundary';

export const machineExecutionsRouter = Router();
machineExecutionsRouter.use(requireApiToken);
machineExecutionsRouter.use(
  express.json({ limit: MAX_CI_CHANGE_CONTEXT_BYTES }),
);

function canAccess(
  req: Parameters<typeof requireApiToken>[0],
  workflowId: string,
) {
  return Boolean(
    req.apiToken && tokenCanExecuteWorkflow(req.apiToken, workflowId),
  );
}

function publicStartError(status: number, error: unknown) {
  const sanitized = status < 500 ? sanitizeWorkflowLogMessage(error) : null;
  return sanitized?.slice(0, 500) || 'Workflow could not be started.';
}

function failureHttpStatus(status: number | null) {
  return status && Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : 502;
}

export function machineExecutionReplayResponse(params: {
  executionId: string;
  executionStatus: string;
  failureHttpStatus: number | null;
  failureMessage: string | null;
  headSha: string;
  workflowId: string;
}) {
  if (params.executionStatus === 'failed_to_start') {
    return {
      body: {
        error: params.failureMessage ?? 'Workflow could not be started.',
        executionId: params.executionId,
        headSha: params.headSha,
        idempotentReused: true,
        status: 'failed_to_start',
        workflowId: params.workflowId,
      },
      httpStatus: failureHttpStatus(params.failureHttpStatus),
    };
  }
  return {
    body: {
      executionId: params.executionId,
      headSha: params.headSha,
      idempotentReused: true,
      status:
        params.executionStatus === 'starting'
          ? 'running'
          : params.executionStatus,
      workflowId: params.workflowId,
    },
    httpStatus: 202,
  };
}

machineExecutionsRouter.post('/:workflowId/executions', async (req, res) => {
  const workflowId = req.params.workflowId;
  const token = req.apiToken!;
  if (!canAccess(req, workflowId)) {
    res.status(404).json({ error: 'Workflow not found.' });
    return;
  }

  let ci;
  try {
    ci = parseCiChangeContext(req.body);
  } catch (error) {
    res.status(400).json({
      error:
        error instanceof CiChangeContextValidationError
          ? error.message
          : 'Invalid CI change context.',
    });
    return;
  }

  const workflow = await prisma.workflow.findFirst({
    select: { id: true, nodes: true },
    where: { id: workflowId, userId: token.userId },
  });
  if (!workflow) {
    res.status(404).json({ error: 'Workflow not found.' });
    return;
  }
  const ciPolicyError = machineExecutionCiPolicyError(
    workflow.nodes,
    ci.eventType,
  );
  if (ciPolicyError) {
    res.status(400).json({ error: ciPolicyError });
    return;
  }

  const reserved = await reserveCiWorkflowExecution({
    context: ci,
    executionId: crypto.randomUUID(),
    workflowId,
  });
  let reservation = reserved.reservation;
  let shouldStart = reserved.created;
  if (!shouldStart) {
    if (!ciReservationMatchesContext(reservation, ci)) {
      res.status(409).json({
        error:
          'This workflow and head SHA already use a different CI change context.',
      });
      return;
    }
    const retryClaim = await claimRetryableCiWorkflowExecution(
      reservation,
      crypto.randomUUID(),
    );
    reservation = retryClaim.reservation;
    if (retryClaim.claimed) {
      shouldStart = true;
    }
  }
  if (!shouldStart) {
    const status = await readCiWorkflowExecutionStatus(reservation);
    const replay = machineExecutionReplayResponse({
      executionId: reservation.executionId,
      executionStatus: status,
      failureHttpStatus: reservation.failureHttpStatus,
      failureMessage: reservation.failureMessage,
      headSha: ci.headSha,
      workflowId,
    });
    res.status(replay.httpStatus).json(replay.body);
    return;
  }

  try {
    const agentMemoryByNodeId = await loadAgentMemoryByNodeId({
      changeContext: ci,
      workflowId,
    });
    const started = await executeSavedWorkflow({
      agentMemoryByNodeId,
      body: { ci },
      executionId: reservation.executionId,
      req,
      trigger: { data: ci, name: 'ci' },
      userId: token.userId,
      workflowId,
    });
    if (!started) {
      const message = 'Workflow not found.';
      await markCiWorkflowExecutionStartFailed(
        reservation.id,
        reservation.executionId,
        {
          message,
          status: 404,
        },
      );
      res.status(404).json({
        error: message,
        executionId: reservation.executionId,
        headSha: ci.headSha,
        idempotentReused: false,
        status: 'failed_to_start',
        workflowId,
      });
      return;
    }
    if (started.result.status < 200 || started.result.status >= 300) {
      const status = failureHttpStatus(started.result.status);
      const message = publicStartError(status, started.result.body.error);
      await markCiWorkflowExecutionStartFailed(
        reservation.id,
        reservation.executionId,
        {
          message,
          status,
        },
      );
      res.status(status).json({
        error: message,
        executionId: reservation.executionId,
        headSha: ci.headSha,
        idempotentReused: false,
        status: 'failed_to_start',
        workflowId,
      });
      return;
    }
  } catch (error) {
    console.error('Failed to start idempotent CI workflow execution:', error);
    await markCiWorkflowExecutionStartFailed(
      reservation.id,
      reservation.executionId,
      {
        message: 'Workflow could not be started.',
        status: 500,
      },
    );
    res.status(500).json({
      error: 'Workflow could not be started.',
      executionId: reservation.executionId,
      headSha: ci.headSha,
      idempotentReused: false,
      status: 'failed_to_start',
      workflowId,
    });
    return;
  }

  try {
    await markCiWorkflowExecutionRunning(
      reservation.id,
      reservation.executionId,
    );
  } catch (error) {
    // The workflow has already started. A replay can derive its status from
    // WorkflowExecution even if this advisory reservation update is delayed.
    console.error('Failed to mark CI workflow reservation as running:', error);
  }

  try {
    await apiTokens.auditExecution({
      apiTokenId: token.id,
      executionId: reservation.executionId,
      userId: token.userId,
      workflowId,
    });
  } catch (error) {
    console.error('Failed to audit API token execution:', error);
  }
  res.status(202).json({
    executionId: reservation.executionId,
    headSha: ci.headSha,
    idempotentReused: false,
    status: 'running',
    workflowId,
  });
});

machineExecutionsRouter.get(
  '/:workflowId/executions/:executionId',
  async (req, res) => {
    const token = req.apiToken!;
    const workflowId = req.params.workflowId;
    if (!canAccess(req, workflowId)) {
      res.status(404).json({ error: 'Workflow execution not found.' });
      return;
    }
    const execution = await executionEvents.getExecutionForUser(
      req.params.executionId,
      token.userId,
    );
    if (execution && execution.workflowId === workflowId) {
      res.json({
        executionId: execution.id,
        status: execution.status,
        workflowId,
        startedAt: execution.startedAt.toISOString(),
        completedAt: execution.completedAt?.toISOString() ?? null,
      });
      return;
    }
    const reservation = await prisma.workflowCiExecution.findFirst({
      where: { executionId: req.params.executionId, workflowId },
    });
    if (!reservation) {
      res.status(404).json({ error: 'Workflow execution not found.' });
      return;
    }
    res.json({
      executionId: reservation.executionId,
      status: reservation.status,
      workflowId,
      startedAt: reservation.createdAt.toISOString(),
      completedAt:
        reservation.status === 'failed_to_start'
          ? reservation.updatedAt.toISOString()
          : null,
    });
  },
);

machineExecutionsRouter.get(
  '/:workflowId/executions/:executionId/events',
  async (req, res) => {
    const token = req.apiToken!;
    const workflowId = req.params.workflowId;
    const execution = await executionEvents.getExecutionForUser(
      req.params.executionId,
      token.userId,
    );
    if (!canAccess(req, workflowId)) {
      res.status(404).json({ error: 'Workflow execution not found.' });
      return;
    }
    if (!execution || execution.workflowId !== workflowId) {
      const reservation = await prisma.workflowCiExecution.findFirst({
        select: { id: true },
        where: { executionId: req.params.executionId, workflowId },
      });
      if (!reservation) {
        res.status(404).json({ error: 'Workflow execution not found.' });
        return;
      }
      res.json({ events: [] });
      return;
    }
    const after = typeof req.query.after === 'string' ? req.query.after : '0';
    let cursor = 0n;
    try {
      cursor = BigInt(after);
    } catch {
      res.status(400).json({ error: 'Invalid event cursor.' });
      return;
    }
    const events = await executionEvents.listSafeEvents(execution.id, cursor);
    res.json({ events });
  },
);

export function machineExecutionJsonError(error: unknown): {
  error: string;
  status: 400 | 413;
} | null {
  const errorType =
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    typeof error.type === 'string'
      ? error.type
      : '';
  if (errorType === 'entity.too.large') {
    return {
      error: `CI change context exceeds ${MAX_CI_CHANGE_CONTEXT_BYTES} bytes.`,
      status: 413,
    };
  }
  if (errorType === 'entity.parse.failed') {
    return { error: 'Invalid CI change context JSON.', status: 400 };
  }
  return null;
}

const machineExecutionJsonErrorHandler: ErrorRequestHandler = (
  error,
  _req,
  res,
  next,
) => {
  const response = machineExecutionJsonError(error);
  if (!response) {
    next(error);
    return;
  }
  res.status(response.status).json({ error: response.error });
};

machineExecutionsRouter.use(machineExecutionJsonErrorHandler);
