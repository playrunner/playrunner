import crypto from 'node:crypto';
import express, { Router, type ErrorRequestHandler } from 'express';
import { requireApiToken } from '../auth/api-token.middleware';
import { prisma } from '../lib/prisma';
import { Prisma } from '../generated/prisma/client.cts';
import { apiRuntime } from '../runtime';
import {
  executionEvents,
  sanitizeWorkflowLogMessage,
} from '../services/execution-events';
import {
  apiTokens,
  tokenCanExecuteWorkflow,
  tokenCanWriteWorkflows,
} from '../services/api-tokens';
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
import {
  MAX_WORKFLOW_RUN_BODY_BYTES,
  parseWorkflowRunInputs,
  WorkflowRunInputValidationError,
} from '../services/workflow-run-inputs';
import {
  MAX_WORKFLOW_DEFINITION_BYTES,
  parseWorkflowDefinition,
  WorkflowDefinitionValidationError,
  workflowDefinitionIds,
} from '../services/workflow-definitions';

export const machineExecutionsRouter = Router();
machineExecutionsRouter.use(requireApiToken);
machineExecutionsRouter.use(
  express.json({
    limit: Math.max(
      MAX_CI_CHANGE_CONTEXT_BYTES,
      MAX_WORKFLOW_DEFINITION_BYTES,
      MAX_WORKFLOW_RUN_BODY_BYTES,
    ),
  }),
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

machineExecutionsRouter.put('/definitions/:workflowKey', async (req, res) => {
  const token = req.apiToken!;
  if (!tokenCanWriteWorkflows(token)) {
    res.status(403).json({
      error:
        'This API token cannot manage workflows. Use an unrestricted token with workflow:write.',
    });
    return;
  }

  try {
    const definition = parseWorkflowDefinition(req.body);
    if (definition.workflow.key !== req.params.workflowKey) {
      res.status(400).json({
        error: 'The workflow key in the URL and definition must match.',
      });
      return;
    }
    const ids = workflowDefinitionIds(token.userId, definition);
    const existing = await prisma.workflow.findUnique({
      where: { id: ids.workflowId },
      select: { id: true },
    });
    await prisma.$transaction([
      prisma.project.upsert({
        where: { id: ids.projectId },
        create: {
          id: ids.projectId,
          userId: token.userId,
          title: definition.project.title,
        },
        update: { title: definition.project.title },
      }),
      prisma.workflow.upsert({
        where: { id: ids.workflowId },
        create: {
          id: ids.workflowId,
          userId: token.userId,
          projectId: ids.projectId,
          title: definition.workflow.title,
          nodes: definition.workflow.nodes as Prisma.InputJsonValue,
          connections: definition.workflow.connections as Prisma.InputJsonValue,
          cloudProvider: definition.workflow.cloudProvider,
          concurrency: definition.workflow.concurrency ?? null,
        },
        update: {
          projectId: ids.projectId,
          title: definition.workflow.title,
          nodes: definition.workflow.nodes as Prisma.InputJsonValue,
          connections: definition.workflow.connections as Prisma.InputJsonValue,
          cloudProvider: definition.workflow.cloudProvider,
          concurrency: definition.workflow.concurrency ?? null,
        },
      }),
    ]);
    res.status(existing ? 200 : 201).json({
      created: !existing,
      editorPath: `/workflow/${ids.workflowId}`,
      projectId: ids.projectId,
      workflowId: ids.workflowId,
    });
  } catch (error) {
    if (error instanceof WorkflowDefinitionValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    console.error('Machine workflow definition error:', error);
    res.status(500).json({ error: 'The workflow could not be saved.' });
  }
});

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

  let ci: ReturnType<typeof parseCiChangeContext> | undefined;
  let runInputs;
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { inputs: _inputs, acceptanceCriteria: _criteria, ...ciBody } = body;
    if (Object.keys(ciBody).length) {
      ci = parseCiChangeContext(ciBody);
    }
    runInputs = parseWorkflowRunInputs(body);
  } catch (error) {
    res.status(400).json({
      error:
        error instanceof CiChangeContextValidationError
          ? error.message
          : error instanceof WorkflowRunInputValidationError
            ? error.message
            : 'Invalid CI change context.',
    });
    return;
  }

  const workflow = await prisma.workflow.findFirst({
    select: { cloudProvider: true, id: true, nodes: true },
    where: { id: workflowId, userId: token.userId },
  });
  if (!workflow) {
    res.status(404).json({ error: 'Workflow not found.' });
    return;
  }

  const runner = await apiRuntime.runnerProvisioner.start(
    workflow.cloudProvider || 'LOCAL_RUNNER',
  );
  if (runner.status < 200 || runner.status >= 300) {
    res.status(failureHttpStatus(runner.status)).json({
      error: publicStartError(runner.status, runner.body.error),
    });
    return;
  }

  if (!ci) {
    const executionId = crypto.randomUUID();
    try {
      const started = await executeSavedWorkflow({
        body: {
          ...(Object.keys(runInputs.inputs).length
            ? { inputs: runInputs.inputs }
            : {}),
          ...(runInputs.acceptanceCriteria.length
            ? { acceptanceCriteria: runInputs.acceptanceCriteria }
            : {}),
        },
        executionId,
        req,
        trigger: { data: {}, name: 'cli' },
        userId: token.userId,
        workflowId,
      });
      if (!started) {
        res.status(404).json({ error: 'Workflow not found.' });
        return;
      }
      if (started.result.status < 200 || started.result.status >= 300) {
        const status = failureHttpStatus(started.result.status);
        res.status(status).json({
          error: publicStartError(status, started.result.body.error),
          executionId,
          status: 'failed_to_start',
          workflowId,
        });
        return;
      }
      try {
        await apiTokens.auditExecution({
          apiTokenId: token.id,
          executionId,
          userId: token.userId,
          workflowId,
        });
      } catch (error) {
        console.error('Failed to audit API token execution:', error);
      }
      res.status(202).json({
        executionId,
        status: 'running',
        workflowId,
      });
    } catch (error) {
      console.error('Failed to start CLI workflow execution:', error);
      res.status(500).json({ error: 'Workflow could not be started.' });
    }
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
    const started = await executeSavedWorkflow({
      body: {
        ci,
        ...(Object.keys(runInputs.inputs).length
          ? { inputs: runInputs.inputs }
          : {}),
        ...(runInputs.acceptanceCriteria.length
          ? { acceptanceCriteria: runInputs.acceptanceCriteria }
          : {}),
      },
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
      error: `Workflow run request exceeds ${MAX_WORKFLOW_RUN_BODY_BYTES} bytes.`,
      status: 413,
    };
  }
  if (errorType === 'entity.parse.failed') {
    return { error: 'Invalid workflow run JSON.', status: 400 };
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
