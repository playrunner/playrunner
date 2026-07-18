import { Prisma } from '../generated/prisma/client.cts';
import { Request, Response, Router } from 'express';
import { prisma } from '../lib/prisma';

export const insightsRouter = Router();

type InsightWindow = {
  days: number | null;
  label: string;
  since: Date | null;
};

type ExecutionRow = {
  id: string;
  workflowId: string | null;
  cloudProvider: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date;
  completedAt: Date | null;
};

type WorkflowRow = {
  id: string;
  projectId: string | null;
  title: string | null;
  cloudProvider: string | null;
  concurrency: number | null;
  nodes: Prisma.JsonValue | null;
  connections: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
};

type EventRow = {
  id: bigint;
  executionId: string;
  workflowId: string | null;
  nodeId: string | null;
  type: string;
  level: string | null;
  message: string | null;
  payload: Prisma.JsonValue;
  occurredAt: Date | null;
  createdAt: Date;
};

type CountTotals = {
  cancelled: number;
  completed: number;
  failed: number;
  running: number;
  total: number;
};

function getUserId(req: Request) {
  if (!req.authUser?.providerUserId) {
    throw new Error('Missing authenticated user.');
  }

  return req.authUser.providerUserId;
}

function sendError(res: Response, error: unknown) {
  console.error('Insights route error:', error);
  res.status(500).json({
    error: error instanceof Error ? error.message : 'Internal server error.',
  });
}

function createRouteHandler(
  handler: (req: Request, res: Response) => Promise<void> | void,
) {
  return (req: Request, res: Response) => {
    Promise.resolve(handler(req, res)).catch((error) => sendError(res, error));
  };
}

function parseWindow(value: unknown): InsightWindow {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === 'all') {
    return {
      days: null,
      label: 'All time',
      since: null,
    };
  }

  const days = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : 30;
  const boundedDays = Math.min(Math.max(days, 1), 365);
  const since = new Date(Date.now() - boundedDays * 24 * 60 * 60 * 1000);

  return {
    days: boundedDays,
    label: `Last ${boundedDays} days`,
    since,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: Prisma.JsonValue | null) {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getPayload(event: EventRow) {
  return isRecord(event.payload) ? event.payload : {};
}

function getNestedRecord(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const nested = value[key];
  return isRecord(nested) ? nested : null;
}

function getEventTimestamp(event: EventRow) {
  return event.occurredAt ?? event.createdAt;
}

function getEventMessage(event: EventRow) {
  const payload = getPayload(event);
  const state = asString(payload.state);

  if (event.type === 'node_state' && state) {
    return `${event.nodeId ?? 'Node'} state changed to ${state}.`;
  }

  return (
    event.message ??
    asString(payload.message) ??
    asString(payload.error) ??
    asString(payload.stderr) ??
    null
  );
}

function getEventReportUrl(event: EventRow) {
  const payload = getPayload(event);
  const output = getNestedRecord(payload, 'output');

  return asString(output?.reportUrl) ?? asString(payload.reportUrl);
}

function isErrorEvent(event: EventRow) {
  const payload = getPayload(event);
  const type = event.type.toLowerCase();
  const level = event.level?.toLowerCase();
  const state = asString(payload.state)?.toLowerCase();

  return (
    level === 'error' ||
    state === 'error' ||
    type.includes('failed') ||
    type.includes('error')
  );
}

function getExecutionDurationMs(execution: ExecutionRow) {
  const isTerminal = execution.status !== 'running';
  const end =
    execution.completedAt ?? (isTerminal ? execution.updatedAt : null);

  if (!end) {
    return null;
  }

  const duration = end.getTime() - execution.startedAt.getTime();
  return duration >= 0 ? duration : null;
}

function average(values: number[]) {
  if (!values.length) {
    return null;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function percentile(values: number[], percentileValue: number) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(percentileValue * sorted.length) - 1),
  );

  return sorted[index];
}

function countStatuses(executions: ExecutionRow[]): CountTotals {
  return executions.reduce<CountTotals>(
    (totals, execution) => {
      totals.total += 1;

      if (execution.status === 'completed') {
        totals.completed += 1;
      } else if (execution.status === 'failed') {
        totals.failed += 1;
      } else if (execution.status === 'cancelled') {
        totals.cancelled += 1;
      } else if (execution.status === 'running') {
        totals.running += 1;
      }

      return totals;
    },
    {
      cancelled: 0,
      completed: 0,
      failed: 0,
      running: 0,
      total: 0,
    },
  );
}

function successRate(totals: CountTotals) {
  const terminal = totals.completed + totals.failed + totals.cancelled;
  return terminal > 0 ? totals.completed / terminal : null;
}

function failureRate(totals: CountTotals) {
  const terminal = totals.completed + totals.failed + totals.cancelled;
  return terminal > 0 ? totals.failed / terminal : null;
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function createCountMap<T extends string | number>(
  items: T[],
): Record<string, number> {
  return items.reduce<Record<string, number>>((totals, item) => {
    const key = String(item || 'unknown');
    totals[key] = (totals[key] ?? 0) + 1;
    return totals;
  }, {});
}

function getWorkflowTitle(workflow?: WorkflowRow) {
  return workflow?.title?.trim() || 'Untitled workflow';
}

function buildWorkflowNodeLookup(workflows: WorkflowRow[]) {
  const lookup = new Map<
    string,
    {
      label: string;
      nodeType: string;
      workflowId: string;
      workflowTitle: string;
    }
  >();

  for (const workflow of workflows) {
    for (const node of asArray(workflow.nodes)) {
      if (!isRecord(node)) {
        continue;
      }

      const nodeId = asString(node.id);
      if (!nodeId) {
        continue;
      }

      lookup.set(`${workflow.id}:${nodeId}`, {
        label: asString(node.label) ?? nodeId,
        nodeType: asString(node.nodeType) ?? 'node',
        workflowId: workflow.id,
        workflowTitle: getWorkflowTitle(workflow),
      });
    }
  }

  return lookup;
}

function round(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

insightsRouter.get(
  '/',
  createRouteHandler(async (req, res) => {
    const userId = getUserId(req);
    const reportWindow = parseWindow(req.query.days);
    const executionWhere = {
      userId,
      ...(reportWindow.since ? { createdAt: { gte: reportWindow.since } } : {}),
    };
    const eventWhere = {
      userId,
      ...(reportWindow.since ? { createdAt: { gte: reportWindow.since } } : {}),
    };

    const [
      projects,
      workflows,
      executions,
      events,
      integrations,
      cloudCredentials,
      environments,
      secrets,
    ] = await prisma.$transaction([
      prisma.project.findMany({
        where: { userId },
        select: { id: true, title: true, createdAt: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.workflow.findMany({
        where: { userId },
        select: {
          id: true,
          projectId: true,
          title: true,
          cloudProvider: true,
          concurrency: true,
          nodes: true,
          connections: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.workflowExecution.findMany({
        where: executionWhere,
        select: {
          id: true,
          workflowId: true,
          cloudProvider: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          startedAt: true,
          completedAt: true,
        },
        orderBy: { startedAt: 'desc' },
      }),
      prisma.workflowEvent.findMany({
        where: eventWhere,
        select: {
          id: true,
          executionId: true,
          workflowId: true,
          nodeId: true,
          type: true,
          level: true,
          message: true,
          payload: true,
          occurredAt: true,
          createdAt: true,
        },
        orderBy: { id: 'desc' },
      }),
      prisma.integration.findMany({
        where: { userId },
        select: { provider: true, createdAt: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.cloudCredential.findMany({
        where: { userId },
        select: { provider: true, createdAt: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.environment.findMany({
        where: { userId },
        select: { id: true, name: true, createdAt: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.secret.findMany({
        where: { userId },
        select: { id: true, createdAt: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    const workflowsById = new Map(
      workflows.map((workflow) => [workflow.id, workflow]),
    );
    const eventsByExecution = new Map<
      string,
      {
        error: number;
        total: number;
      }
    >();
    const latestReportUrlByExecution = new Map<string, string>();
    const errorEvents = events.filter(isErrorEvent);

    for (const event of events) {
      const executionCounts = eventsByExecution.get(event.executionId) ?? {
        error: 0,
        total: 0,
      };
      executionCounts.total += 1;
      if (isErrorEvent(event)) {
        executionCounts.error += 1;
      }
      eventsByExecution.set(event.executionId, executionCounts);

      const reportUrl = getEventReportUrl(event);
      if (reportUrl && !latestReportUrlByExecution.has(event.executionId)) {
        latestReportUrlByExecution.set(event.executionId, reportUrl);
      }
    }

    const durations = executions
      .map(getExecutionDurationMs)
      .filter((duration): duration is number => duration !== null);
    const totals = countStatuses(executions);
    const totalNodeCount = workflows.reduce(
      (total, workflow) => total + asArray(workflow.nodes).length,
      0,
    );
    const totalConnectionCount = workflows.reduce(
      (total, workflow) => total + asArray(workflow.connections).length,
      0,
    );

    const dailyRuns = new Map<
      string,
      CountTotals & {
        avgDurationMs: number | null;
        durations: number[];
        errorEvents: number;
      }
    >();
    for (const execution of executions) {
      const key = dayKey(execution.startedAt);
      const current =
        dailyRuns.get(key) ??
        ({
          ...countStatuses([]),
          avgDurationMs: null,
          durations: [],
          errorEvents: 0,
        } satisfies CountTotals & {
          avgDurationMs: number | null;
          durations: number[];
          errorEvents: number;
        });

      current.total += 1;
      if (execution.status === 'completed') current.completed += 1;
      if (execution.status === 'failed') current.failed += 1;
      if (execution.status === 'cancelled') current.cancelled += 1;
      if (execution.status === 'running') current.running += 1;

      const duration = getExecutionDurationMs(execution);
      if (duration !== null) {
        current.durations.push(duration);
      }

      dailyRuns.set(key, current);
    }

    for (const event of errorEvents) {
      const key = dayKey(getEventTimestamp(event));
      const current =
        dailyRuns.get(key) ??
        ({
          ...countStatuses([]),
          avgDurationMs: null,
          durations: [],
          errorEvents: 0,
        } satisfies CountTotals & {
          avgDurationMs: number | null;
          durations: number[];
          errorEvents: number;
        });
      current.errorEvents += 1;
      dailyRuns.set(key, current);
    }

    const statusCounts = createCountMap(
      executions.map((execution) => execution.status),
    );
    const statusBreakdown = Object.entries(statusCounts)
      .map(([status, count]) => ({
        count,
        percent: totals.total ? count / totals.total : null,
        status,
      }))
      .sort((left, right) => right.count - left.count);

    const providerMap = new Map<string, ExecutionRow[]>();
    for (const execution of executions) {
      const provider = execution.cloudProvider || 'Unknown';
      providerMap.set(provider, [
        ...(providerMap.get(provider) ?? []),
        execution,
      ]);
    }
    const providerBreakdown = Array.from(providerMap.entries())
      .map(([provider, providerExecutions]) => {
        const providerTotals = countStatuses(providerExecutions);
        const providerDurations = providerExecutions
          .map(getExecutionDurationMs)
          .filter((duration): duration is number => duration !== null);
        const providerExecutionIds = new Set(
          providerExecutions.map((execution) => execution.id),
        );
        const providerErrorEvents = errorEvents.filter((event) =>
          providerExecutionIds.has(event.executionId),
        ).length;

        return {
          ...providerTotals,
          avgDurationMs: round(average(providerDurations), 0),
          errorEvents: providerErrorEvents,
          lastRunAt: providerExecutions[0]?.startedAt ?? null,
          p95DurationMs: round(percentile(providerDurations, 0.95), 0),
          provider,
          successRate: round(successRate(providerTotals), 4),
        };
      })
      .sort((left, right) => right.total - left.total);

    const workflowMap = new Map<string, ExecutionRow[]>();
    for (const execution of executions) {
      const workflowId = execution.workflowId ?? 'unknown';
      workflowMap.set(workflowId, [
        ...(workflowMap.get(workflowId) ?? []),
        execution,
      ]);
    }
    for (const workflow of workflows) {
      if (!workflowMap.has(workflow.id)) {
        workflowMap.set(workflow.id, []);
      }
    }
    const workflowBreakdown = Array.from(workflowMap.entries())
      .map(([workflowId, workflowExecutions]) => {
        const workflow = workflowsById.get(workflowId);
        const workflowTotals = countStatuses(workflowExecutions);
        const workflowDurations = workflowExecutions
          .map(getExecutionDurationMs)
          .filter((duration): duration is number => duration !== null);
        const workflowExecutionIds = new Set(
          workflowExecutions.map((execution) => execution.id),
        );
        const workflowErrorEvents = errorEvents.filter((event) =>
          workflowExecutionIds.has(event.executionId),
        ).length;

        return {
          ...workflowTotals,
          avgDurationMs: round(average(workflowDurations), 0),
          cloudProvider:
            workflow?.cloudProvider ??
            workflowExecutions[0]?.cloudProvider ??
            null,
          concurrency: workflow?.concurrency ?? null,
          connectionCount: workflow ? asArray(workflow.connections).length : 0,
          errorEvents: workflowErrorEvents,
          lastRunAt: workflowExecutions[0]?.startedAt ?? null,
          lastStatus: workflowExecutions[0]?.status ?? null,
          nodeCount: workflow ? asArray(workflow.nodes).length : 0,
          p95DurationMs: round(percentile(workflowDurations, 0.95), 0),
          successRate: round(successRate(workflowTotals), 4),
          title: workflow ? getWorkflowTitle(workflow) : 'Deleted workflow',
          workflowId,
        };
      })
      .sort((left, right) => {
        if (!left.lastRunAt && right.lastRunAt) return 1;
        if (left.lastRunAt && !right.lastRunAt) return -1;
        return right.total - left.total;
      });

    const nodeLookup = buildWorkflowNodeLookup(workflows);
    const latestNodeStates = new Map<
      string,
      {
        event: EventRow;
        state: string;
      }
    >();
    for (const event of events) {
      if (event.type !== 'node_state' || !event.nodeId) {
        continue;
      }

      const state = asString(getPayload(event).state);
      if (!state) {
        continue;
      }

      const key = `${event.workflowId ?? 'unknown'}:${event.nodeId}:${event.executionId}`;
      if (!latestNodeStates.has(key)) {
        latestNodeStates.set(key, { event, state });
      }
    }

    const nodeMap = new Map<
      string,
      {
        error: number;
        lastSeenAt: Date | null;
        label: string;
        nodeId: string;
        nodeType: string;
        pending: number;
        running: number;
        success: number;
        total: number;
        warning: number;
        workflowId: string | null;
        workflowTitle: string;
      }
    >();
    for (const { event, state } of latestNodeStates.values()) {
      const workflowId = event.workflowId ?? null;
      const lookup =
        workflowId && event.nodeId
          ? nodeLookup.get(`${workflowId}:${event.nodeId}`)
          : null;
      const key = `${workflowId ?? 'unknown'}:${event.nodeId}`;
      const current =
        nodeMap.get(key) ??
        ({
          error: 0,
          label: lookup?.label ?? event.nodeId ?? 'Unknown node',
          lastSeenAt: null,
          nodeId: event.nodeId ?? 'unknown',
          nodeType: lookup?.nodeType ?? 'node',
          pending: 0,
          running: 0,
          success: 0,
          total: 0,
          warning: 0,
          workflowId,
          workflowTitle: lookup?.workflowTitle ?? 'Unknown workflow',
        } satisfies {
          error: number;
          lastSeenAt: Date | null;
          label: string;
          nodeId: string;
          nodeType: string;
          pending: number;
          running: number;
          success: number;
          total: number;
          warning: number;
          workflowId: string | null;
          workflowTitle: string;
        });

      current.total += 1;
      if (state === 'success') current.success += 1;
      if (state === 'error') current.error += 1;
      if (state === 'warning') current.warning += 1;
      if (state === 'running') current.running += 1;
      if (state === 'pending') current.pending += 1;

      const eventTimestamp = getEventTimestamp(event);
      if (!current.lastSeenAt || eventTimestamp > current.lastSeenAt) {
        current.lastSeenAt = eventTimestamp;
      }
      nodeMap.set(key, current);
    }
    const nodeBreakdown = Array.from(nodeMap.values())
      .map((node) => ({
        ...node,
        successRate:
          node.success + node.error + node.warning > 0
            ? round(
                node.success / (node.success + node.error + node.warning),
                4,
              )
            : null,
      }))
      .sort(
        (left, right) => right.error - left.error || right.total - left.total,
      );

    const topErrorMap = new Map<
      string,
      {
        affectedExecutions: Set<string>;
        count: number;
        lastSeenAt: Date;
        message: string;
      }
    >();
    for (const event of errorEvents) {
      const message = getEventMessage(event) ?? `${event.type} event`;
      const normalized = message.replace(/\s+/g, ' ').trim().slice(0, 240);
      const timestamp = getEventTimestamp(event);
      const current =
        topErrorMap.get(normalized) ??
        ({
          affectedExecutions: new Set<string>(),
          count: 0,
          lastSeenAt: timestamp,
          message: normalized,
        } satisfies {
          affectedExecutions: Set<string>;
          count: number;
          lastSeenAt: Date;
          message: string;
        });
      current.count += 1;
      current.affectedExecutions.add(event.executionId);
      if (timestamp > current.lastSeenAt) {
        current.lastSeenAt = timestamp;
      }
      topErrorMap.set(normalized, current);
    }
    const topErrors = Array.from(topErrorMap.values())
      .map((error) => ({
        affectedExecutions: error.affectedExecutions.size,
        count: error.count,
        lastSeenAt: error.lastSeenAt,
        message: error.message,
      }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 10);

    const executionById = new Map(
      executions.map((execution) => [execution.id, execution]),
    );
    const recentErrors = errorEvents.slice(0, 12).map((event) => {
      const execution = executionById.get(event.executionId);
      const workflow = event.workflowId
        ? workflowsById.get(event.workflowId)
        : null;
      return {
        cloudProvider: execution?.cloudProvider ?? null,
        executionId: event.executionId,
        id: event.id.toString(),
        level: event.level,
        message: getEventMessage(event) ?? `${event.type} event`,
        nodeId: event.nodeId,
        occurredAt: getEventTimestamp(event),
        type: event.type,
        workflowId: event.workflowId,
        workflowTitle: workflow
          ? getWorkflowTitle(workflow)
          : 'Unknown workflow',
      };
    });

    const eventTypeCounts = new Map<
      string,
      {
        count: number;
        level: string | null;
        type: string;
      }
    >();
    for (const event of events) {
      const key = `${event.type}:${event.level ?? ''}`;
      const current =
        eventTypeCounts.get(key) ??
        ({
          count: 0,
          level: event.level,
          type: event.type,
        } satisfies { count: number; level: string | null; type: string });
      current.count += 1;
      eventTypeCounts.set(key, current);
    }

    const recentExecutions = executions.slice(0, 15).map((execution) => {
      const workflow = execution.workflowId
        ? workflowsById.get(execution.workflowId)
        : null;
      const eventCounts = eventsByExecution.get(execution.id) ?? {
        error: 0,
        total: 0,
      };

      return {
        cloudProvider: execution.cloudProvider,
        completedAt: execution.completedAt,
        durationMs: getExecutionDurationMs(execution),
        errorEvents: eventCounts.error,
        eventCount: eventCounts.total,
        id: execution.id,
        reportUrl: latestReportUrlByExecution.get(execution.id) ?? null,
        startedAt: execution.startedAt,
        status: execution.status,
        workflowId: execution.workflowId,
        workflowTitle: workflow
          ? getWorkflowTitle(workflow)
          : 'Unknown workflow',
      };
    });

    const insights = {
      dailyRuns: Array.from(dailyRuns.entries())
        .map(([date, entry]) => ({
          avgDurationMs: round(average(entry.durations), 0),
          cancelled: entry.cancelled,
          completed: entry.completed,
          date,
          errorEvents: entry.errorEvents,
          failed: entry.failed,
          running: entry.running,
          total: entry.total,
        }))
        .sort((left, right) => left.date.localeCompare(right.date)),
      eventTypes: Array.from(eventTypeCounts.values())
        .sort((left, right) => right.count - left.count)
        .slice(0, 12),
      generatedAt: new Date(),
      nodeBreakdown,
      providerBreakdown,
      recentErrors,
      recentExecutions,
      statusBreakdown,
      summary: {
        ...totals,
        avgDurationMs: round(average(durations), 0),
        cloudCredentialCount: cloudCredentials.length,
        cloudCredentialProviders: cloudCredentials.map(
          (credential) => credential.provider,
        ),
        connectionCount: totalConnectionCount,
        environmentCount: environments.length,
        errorEvents: errorEvents.length,
        failureRate: round(failureRate(totals), 4),
        integrationCount: integrations.length,
        integrationProviders: integrations.map(
          (integration) => integration.provider,
        ),
        latestExecutionAt: executions[0]?.startedAt ?? null,
        nodeCount: totalNodeCount,
        p95DurationMs: round(percentile(durations, 0.95), 0),
        projectCount: projects.length,
        secretCount: secrets.length,
        successRate: round(successRate(totals), 4),
        totalEvents: events.length,
        workflowCount: workflows.length,
      },
      topErrors,
      window: {
        days: reportWindow.days,
        label: reportWindow.label,
        since: reportWindow.since,
      },
      workflowBreakdown,
      workspace: {
        cloudCredentials: cloudCredentials.map((credential) => ({
          provider: credential.provider,
          updatedAt: credential.updatedAt,
        })),
        environments: environments.map((environment) => ({
          id: environment.id,
          name: environment.name,
          updatedAt: environment.updatedAt,
        })),
        integrations: integrations.map((integration) => ({
          provider: integration.provider,
          updatedAt: integration.updatedAt,
        })),
        projects: projects.map((project) => ({
          id: project.id,
          title: project.title ?? 'Untitled project',
          updatedAt: project.updatedAt,
        })),
        secrets: {
          count: secrets.length,
          lastUpdatedAt: secrets[0]?.updatedAt ?? null,
        },
      },
    };

    res.json({ insights, report: insights });
  }),
);
