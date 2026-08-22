import crypto from 'crypto';
import type { Request } from 'express';
import { prisma } from '../lib/prisma';
import { apiRuntime } from '../runtime';
import { state } from '../state';
import { buildSavedWorkflowExecutionBody } from './saved-workflow-payload';
import { machineExecutionCiPolicyError } from './execution-trust-boundary';

type SavedWorkflowTrigger = {
  data?: Record<string, unknown>;
  name: 'ci' | 'schedule' | 'webhook';
};

type SavedWorkflowRecord = {
  cloudProvider: string | null;
  concurrency: number | null;
  connections: unknown;
  id: string;
  nodes: unknown;
  title: string | null;
  userId: string;
};

type SavedWorkflowExecutionDependencies = {
  executeWorkflow: typeof apiRuntime.workflowExecution.execute;
  findWorkflow: (params: {
    userId: string;
    workflowId: string;
  }) => Promise<SavedWorkflowRecord | null>;
};

export async function executeSavedWorkflow(
  params: {
    agentMemoryByNodeId?: Record<string, unknown>;
    body?: Record<string, unknown>;
    executionId?: string;
    req: Request;
    trigger: SavedWorkflowTrigger;
    userId: string;
    workflowId: string;
  },
  dependencies?: SavedWorkflowExecutionDependencies,
) {
  const workflow = await (dependencies?.findWorkflow
    ? dependencies.findWorkflow({
        userId: params.userId,
        workflowId: params.workflowId,
      })
    : prisma.workflow.findFirst({
        where: { id: params.workflowId, userId: params.userId },
      }));
  if (!workflow) return null;

  const executionId = params.executionId ?? crypto.randomUUID();
  const cloudProvider = workflow.cloudProvider || 'LOCAL_RUNNER';
  const ciPolicyError =
    params.trigger.name === 'ci'
      ? machineExecutionCiPolicyError(
          workflow.nodes,
          params.trigger.data?.eventType,
        )
      : null;
  if (ciPolicyError) {
    return {
      cloudProvider,
      executionId,
      result: { body: { error: ciPolicyError }, status: 400 },
      workflow,
    };
  }
  state.testCloudProviders[executionId] = cloudProvider;
  const triggerData = params.trigger.data ?? {};
  const result = await (
    dependencies?.executeWorkflow ?? apiRuntime.workflowExecution.execute
  )({
    body: buildSavedWorkflowExecutionBody({
      agentMemoryByNodeId: params.agentMemoryByNodeId,
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
