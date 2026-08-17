import crypto from 'crypto';
import type { Request } from 'express';
import { prisma } from '../lib/prisma';
import { apiRuntime } from '../runtime';
import { state } from '../state';
import { buildSavedWorkflowExecutionBody } from './saved-workflow-payload';

type SavedWorkflowTrigger = {
  data?: Record<string, unknown>;
  name: 'ci' | 'schedule' | 'webhook';
};

export async function executeSavedWorkflow(params: {
  body?: Record<string, unknown>;
  executionId?: string;
  req: Request;
  trigger: SavedWorkflowTrigger;
  userId: string;
  workflowId: string;
}) {
  const workflow = await prisma.workflow.findFirst({
    where: { id: params.workflowId, userId: params.userId },
  });
  if (!workflow) return null;

  const executionId = params.executionId ?? crypto.randomUUID();
  const cloudProvider = workflow.cloudProvider || 'LOCAL_RUNNER';
  state.testCloudProviders[executionId] = cloudProvider;
  const triggerData = params.trigger.data ?? {};
  const result = await apiRuntime.workflowExecution.execute({
    body: buildSavedWorkflowExecutionBody({
      body: params.body,
      executionId,
      triggerData,
      triggerName: params.trigger.name,
      workflow,
    }),
    req: params.req,
    resourceOwnerUserId: workflow.userId,
    testId: executionId,
  });

  return { cloudProvider, executionId, result, workflow };
}
