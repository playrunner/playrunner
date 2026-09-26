import { createHash } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { accessibleWorkflowWhere } from './workflow-access';
import { projectExecution } from './execution-dashboard';
import {
  evaluatePlanEvidence,
  validateTestPlan,
  type ReportTest,
} from '../../../runners/shared/test-plan';

const record = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};

export function buildWorkflowPlanReport(
  execution: Parameters<typeof projectExecution>[0],
) {
  const definition = record(
    execution.events.find((event) => event.type === 'execution_definition')
      ?.payload,
  );
  if (!definition.testPlan) return null;
  const plan = validateTestPlan(definition.testPlan);
  const snapshot = projectExecution(execution);
  const nodeIds = new Set((definition.nodes ?? []).map((node: any) => node.id));
  const outputs = new Map<string, Record<string, any>>();
  for (const event of [...execution.events].sort((a, b) =>
    a.id < b.id ? -1 : 1,
  )) {
    if (
      event.type === 'node_output' &&
      event.nodeId &&
      nodeIds.has(event.nodeId)
    ) {
      const output = record(record(event.payload).output);
      // Media-only updates must not replace a node's test evidence.
      if (output.report) outputs.set(event.nodeId, record(output.report));
    }
  }
  let reportErrors = false;
  const evidence: ReportTest[] = [];
  for (const node of snapshot.nodes.filter((node) => nodeIds.has(node.id))) {
    evidence.push({
      kind: 'node',
      nodeId: node.id,
      title: node.title,
      project: '',
      evidenceId: '',
      status:
        node.status === 'succeeded'
          ? 'PASS'
          : node.status === 'failed'
            ? 'FAIL'
            : node.status === 'skipped'
              ? 'SKIPPED'
              : node.status === 'cancelled'
                ? 'BLOCKED'
                : 'NOT RUN',
    });
    const output = outputs.get(node.id);
    if (output?.errors?.length) reportErrors = true;
    if (Array.isArray(output?.planTests)) {
      for (const test of output.planTests) {
        if (
          typeof test.title !== 'string' ||
          typeof test.project !== 'string' ||
          !['PASS', 'FAIL', 'BLOCKED', 'SKIPPED', 'NOT RUN'].includes(
            test.status,
          )
        )
          continue;
        evidence.push({
          kind: 'test',
          nodeId: node.id,
          title: test.title,
          project: test.project,
          status: test.status,
          evidenceId: String(test.evidenceId ?? ''),
        });
      }
    }
  }
  const result = evaluatePlanEvidence(plan, evidence, reportErrors);
  if (snapshot.status === 'failed') result.status = 'FAIL';
  else if (snapshot.status !== 'completed') result.status = 'BLOCKED';
  return {
    ...result,
    plan,
    version: createHash('sha256').update(JSON.stringify(plan)).digest('hex'),
    executionId: execution.id,
    workflowId: execution.workflowId,
    title: snapshot.title,
    executionStatus: snapshot.status,
    nodes: snapshot.nodes,
  };
}

export async function getWorkflowPlanReport(
  executionId: string,
  userId: string,
) {
  const workflows = await prisma.workflow.findMany({
    where: accessibleWorkflowWhere(userId),
    select: { id: true },
  });
  const execution = await prisma.workflowExecution.findFirst({
    where: {
      id: executionId,
      OR: [{ userId }, { workflowId: { in: workflows.map((w) => w.id) } }],
    },
    include: {
      events: {
        where: {
          type: {
            in: [
              'execution_definition',
              'node_output',
              'node_state',
              'node_started',
              'node_completed',
              'node_failed',
              'node_cancelled',
              'workflow_completed',
              'workflow_failed',
              'workflow_cancelled',
            ],
          },
        },
        orderBy: { id: 'asc' },
      },
    },
  });
  return execution ? buildWorkflowPlanReport(execution) : null;
}
