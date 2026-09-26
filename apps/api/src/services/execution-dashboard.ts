import {
  readTestProgress,
  type TestProgress,
} from '../../../runners/shared/test-progress';
import { prisma } from '../lib/prisma';
import { accessibleWorkflowWhere } from './workflow-access';

const terminal = new Set(['succeeded', 'failed', 'cancelled', 'skipped']);
const ACTIVITY_STALE_AFTER_MS = 5 * 60 * 1000;
const stateNames: Record<string, string> = {
  idle: 'pending',
  pending: 'pending',
  running: 'running',
  success: 'succeeded',
  error: 'failed',
  warning: 'warning',
  cancelled: 'cancelled',
  skipped: 'skipped',
};
type Event = {
  id: bigint;
  type: string;
  nodeId: string | null;
  payload: unknown;
  occurredAt: Date | null;
  createdAt: Date;
};
const record = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};

export function projectExecution(
  execution: {
    id: string;
    workflowId: string | null;
    status: string;
    cloudProvider: string;
    startedAt: Date;
    completedAt: Date | null;
    lastEventAt?: Date | null;
    events: Event[];
  },
  workflow?: { title: string | null; project: { title: string | null } | null },
  now = Date.now(),
) {
  const definition = record(
    execution.events.find((e) => e.type === 'execution_definition')?.payload,
  );
  const nodes = new Map<
    string,
    {
      id: string;
      title: string;
      type: string;
      status: string;
      updatedAt: string | null;
      reportUrl: string | null;
      progress: TestProgress | null;
    }
  >();
  for (const node of Array.isArray(definition.nodes) ? definition.nodes : []) {
    nodes.set(node.id, {
      id: node.id,
      title: node.title,
      type: node.type,
      status: 'pending',
      updatedAt: null,
      reportUrl: null,
      progress: null,
    });
  }
  let status = execution.status;
  const events = [...execution.events].sort(
    (a, b) =>
      (a.occurredAt ?? a.createdAt).getTime() -
        (b.occurredAt ?? b.createdAt).getTime() || (a.id < b.id ? -1 : 1),
  );
  for (const event of events) {
    const payload = record(event.payload);
    if (event.type === 'workflow_failed') status = 'failed';
    else if (event.type === 'workflow_cancelled' && status !== 'failed')
      status = 'cancelled';
    else if (event.type === 'workflow_completed' && status === 'running')
      status = 'completed';
    if (!event.nodeId) continue;
    const node = nodes.get(event.nodeId) ?? {
      id: event.nodeId,
      title: event.nodeId,
      type: '',
      status: 'pending',
      updatedAt: null,
      reportUrl: null,
      progress: null,
    };
    if (event.type === 'test_progress') {
      const progress = readTestProgress(payload.progress);
      if (progress) node.progress = progress;
    }
    const next =
      event.type === 'node_state'
        ? stateNames[payload.state]
        : (
            {
              node_started: 'running',
              node_completed: 'succeeded',
              node_failed: 'failed',
              node_cancelled: 'cancelled',
            } as Record<string, string>
          )[event.type];
    if (next && (!terminal.has(node.status) || next === 'failed')) {
      node.status = next;
      node.updatedAt = (event.occurredAt ?? event.createdAt).toISOString();
    }
    const url = record(payload.output).reportUrl ?? payload.reportUrl;
    if (
      typeof url === 'string' &&
      url.startsWith(`/outputs/${execution.id}/`) &&
      !url.includes('..')
    )
      node.reportUrl = url;
    nodes.set(node.id, node);
  }
  // Receipt time also counts logs and other events, not just node transitions.
  // Silence is not a failure: keep the recorded outcome and flag uncertainty.
  const lastActivityAt = execution.events.reduce(
    (latest, event) => Math.max(latest, event.createdAt.getTime()),
    Math.max(
      execution.startedAt.getTime(),
      execution.lastEventAt?.getTime() ?? 0,
    ),
  );
  return {
    id: execution.id,
    workflowId: execution.workflowId,
    title: definition.title || workflow?.title || 'Workflow',
    projectTitle: workflow?.project?.title ?? null,
    status,
    testPlanReportUrl: definition.testPlan
      ? '/executions/' + encodeURIComponent(execution.id) + '/test-plan'
      : null,
    lastActivityAt: new Date(lastActivityAt).toISOString(),
    activityStale:
      status === 'running' && now - lastActivityAt > ACTIVITY_STALE_AFTER_MS,
    cloudProvider: execution.cloudProvider,
    startedAt: execution.startedAt.toISOString(),
    completedAt: execution.completedAt?.toISOString() ?? null,
    nodes: [...nodes.values()],
  };
}

export async function listDashboardExecutions(userId: string) {
  const workflows = await prisma.workflow.findMany({
    where: accessibleWorkflowWhere(userId),
    select: { id: true, title: true, project: { select: { title: true } } },
  });
  const access = {
    OR: [{ userId }, { workflowId: { in: workflows.map((w) => w.id) } }],
  };
  const select = {
    id: true,
    workflowId: true,
    status: true,
    cloudProvider: true,
    startedAt: true,
    completedAt: true,
    events: {
      where: {
        type: {
          in: [
            'execution_definition',
            'node_state',
            'node_started',
            'node_completed',
            'node_failed',
            'node_cancelled',
            'node_output',
            'test_progress',
            'workflow_completed',
            'workflow_failed',
            'workflow_cancelled',
          ],
        },
      },
      orderBy: { id: 'asc' as const },
    },
  };
  // Active runs are never pushed out of the window by recent completed runs.
  const [active, recent, activity] = await prisma.$transaction(
    [
      prisma.workflowExecution.findMany({
        where: { ...access, status: 'running' },
        select,
        orderBy: { startedAt: 'desc' },
      }),
      prisma.workflowExecution.findMany({
        where: { ...access, status: { not: 'running' } },
        select,
        orderBy: { startedAt: 'desc' },
        take: 30,
      }),
      prisma.workflowEvent.groupBy({
        by: ['executionId'],
        where: { execution: { ...access, status: 'running' } },
        _max: { createdAt: true },
      }),
    ],
    { isolationLevel: 'RepeatableRead' },
  );
  const byId = new Map(workflows.map((w) => [w.id, w]));
  const lastEventById = new Map(
    activity.map((event) => [event.executionId, event._max.createdAt]),
  );
  return [...active, ...recent].map((e) =>
    projectExecution(
      { ...e, lastEventAt: lastEventById.get(e.id) },
      byId.get(e.workflowId ?? ''),
    ),
  );
}
