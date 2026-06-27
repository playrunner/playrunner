import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Cloud,
  Database,
  ExternalLink,
  FileText,
  Gauge,
  RefreshCw,
  Server,
  Workflow,
} from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { DbAPI } from '../lib/db';
import { cn } from '../lib/utils';

type InsightRange = '7' | '30' | '90' | 'all';

type Summary = {
  avgDurationMs: number | null;
  cancelled: number;
  cloudCredentialCount: number;
  cloudCredentialProviders: string[];
  completed: number;
  connectionCount: number;
  environmentCount: number;
  errorEvents: number;
  failed: number;
  failureRate: number | null;
  integrationCount: number;
  integrationProviders: string[];
  latestExecutionAt: string | null;
  nodeCount: number;
  p95DurationMs: number | null;
  projectCount: number;
  running: number;
  secretCount: number;
  successRate: number | null;
  total: number;
  totalEvents: number;
  workflowCount: number;
};

type DailyRun = {
  avgDurationMs: number | null;
  cancelled: number;
  completed: number;
  date: string;
  errorEvents: number;
  failed: number;
  running: number;
  total: number;
};

type StatusBreakdown = {
  count: number;
  percent: number | null;
  status: string;
};

type ProviderBreakdown = {
  avgDurationMs: number | null;
  cancelled: number;
  completed: number;
  errorEvents: number;
  failed: number;
  lastRunAt: string | null;
  p95DurationMs: number | null;
  provider: string;
  running: number;
  successRate: number | null;
  total: number;
};

type WorkflowBreakdown = {
  avgDurationMs: number | null;
  cloudProvider: string | null;
  concurrency: number | null;
  connectionCount: number;
  errorEvents: number;
  lastRunAt: string | null;
  lastStatus: string | null;
  nodeCount: number;
  p95DurationMs: number | null;
  successRate: number | null;
  title: string;
  total: number;
  workflowId: string;
};

type NodeBreakdown = {
  error: number;
  label: string;
  lastSeenAt: string | null;
  nodeId: string;
  nodeType: string;
  pending: number;
  running: number;
  success: number;
  successRate: number | null;
  total: number;
  warning: number;
  workflowTitle: string;
};

type TopError = {
  affectedExecutions: number;
  count: number;
  lastSeenAt: string;
  message: string;
};

type RecentError = {
  cloudProvider: string | null;
  executionId: string;
  id: string;
  level: string | null;
  message: string;
  nodeId: string | null;
  occurredAt: string;
  type: string;
  workflowTitle: string;
};

type RecentExecution = {
  cloudProvider: string;
  completedAt: string | null;
  durationMs: number | null;
  errorEvents: number;
  eventCount: number;
  id: string;
  reportUrl: string | null;
  startedAt: string;
  status: string;
  workflowTitle: string;
};

type EventTypeBreakdown = {
  count: number;
  level: string | null;
  type: string;
};

type Workspace = {
  cloudCredentials: Array<{ provider: string; updatedAt: string }>;
  environments: Array<{ id: string; name: string; updatedAt: string }>;
  integrations: Array<{ provider: string; updatedAt: string }>;
  projects: Array<{ id: string; title: string; updatedAt: string }>;
  secrets: { count: number; lastUpdatedAt: string | null };
};

type InsightsPayload = {
  dailyRuns: DailyRun[];
  eventTypes: EventTypeBreakdown[];
  generatedAt: string;
  nodeBreakdown: NodeBreakdown[];
  providerBreakdown: ProviderBreakdown[];
  recentErrors: RecentError[];
  recentExecutions: RecentExecution[];
  statusBreakdown: StatusBreakdown[];
  summary: Summary;
  topErrors: TopError[];
  window: {
    days: number | null;
    label: string;
    since: string | null;
  };
  workflowBreakdown: WorkflowBreakdown[];
  workspace: Workspace;
};

const rangeOptions: Array<{ label: string; value: InsightRange }> = [
  { label: '7 days', value: '7' },
  { label: '30 days', value: '30' },
  { label: '90 days', value: '90' },
  { label: 'All time', value: 'all' },
];

const numberFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
});

const compactNumberFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  notation: 'compact',
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  month: 'short',
});

const dayFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
});

function formatNumber(value: number | null | undefined) {
  return typeof value === 'number' ? numberFormatter.format(value) : 'N/A';
}

function formatCompactNumber(value: number | null | undefined) {
  return typeof value === 'number'
    ? compactNumberFormatter.format(value)
    : 'N/A';
}

function formatPercent(value: number | null | undefined) {
  return typeof value === 'number'
    ? `${Math.round(value * 1000) / 10}%`
    : 'N/A';
}

function formatDuration(ms: number | null | undefined) {
  if (typeof ms !== 'number') {
    return 'N/A';
  }

  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }

  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return 'N/A';
  }

  return dateFormatter.format(new Date(value));
}

function formatDay(value: string) {
  return dayFormatter.format(new Date(`${value}T00:00:00`));
}

function formatStatus(value: string | null | undefined) {
  if (!value) {
    return 'No runs';
  }

  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function statusBadgeVariant(status: string | null | undefined) {
  if (status === 'completed') return 'success';
  if (status === 'failed' || status === 'cancelled') return 'danger';
  if (status === 'running') return 'default';
  return 'outline';
}

function statusBarClass(status: string) {
  if (status === 'completed') return 'bg-emerald-500';
  if (status === 'failed') return 'bg-red-500';
  if (status === 'running') return 'bg-sky-500';
  if (status === 'cancelled') return 'bg-amber-500';
  return 'bg-muted';
}

function shortId(id: string) {
  return id.slice(0, 8);
}

function MetricCard({
  helper,
  icon: Icon,
  label,
  tone = 'default',
  value,
}: {
  helper: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  tone?: 'default' | 'danger' | 'success';
  value: string;
}) {
  return (
    <div className="bg-surface border border-subtle rounded-xl p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            {label}
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-[var(--foreground)]">
            {value}
          </p>
        </div>
        <div
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-lg border',
            tone === 'success'
              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-500'
              : tone === 'danger'
                ? 'border-red-500/20 bg-red-500/10 text-red-500'
                : 'border-subtle bg-surface-hover text-muted',
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-3 text-xs text-muted">{helper}</p>
    </div>
  );
}

function Section({
  action,
  children,
  eyebrow,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  eyebrow?: string;
  title: string;
}) {
  return (
    <section className="bg-surface border border-subtle rounded-xl shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle px-5 py-4">
        <div>
          {eyebrow ? (
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              {eyebrow}
            </p>
          ) : null}
          <h3 className="text-xl font-medium text-[var(--foreground)]">
            {title}
          </h3>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-subtle bg-background p-6 text-center text-sm text-muted">
      {children}
    </div>
  );
}

function DailyRunsChart({ runs }: { runs: DailyRun[] }) {
  const visibleRuns = runs.slice(-30);
  const maxTotal = Math.max(...visibleRuns.map((run) => run.total), 1);

  if (!visibleRuns.length) {
    return <EmptyState>No workflow runs in this window.</EmptyState>;
  }

  return (
    <div className="overflow-x-auto pb-1">
      <div
        className="grid min-w-[720px] items-end gap-2"
        style={{
          gridTemplateColumns: `repeat(${visibleRuns.length}, minmax(24px, 1fr))`,
        }}
      >
        {visibleRuns.map((run) => {
          const totalHeight = Math.max(4, (run.total / maxTotal) * 100);
          const segments = [
            {
              className: 'bg-red-500',
              count: run.failed,
              key: 'failed',
            },
            {
              className: 'bg-emerald-500',
              count: run.completed,
              key: 'completed',
            },
            {
              className: 'bg-sky-500',
              count: run.running,
              key: 'running',
            },
            {
              className: 'bg-amber-500',
              count: run.cancelled,
              key: 'cancelled',
            },
          ];

          return (
            <div key={run.date} className="flex min-w-0 flex-col items-center">
              <div className="flex h-40 w-full items-end">
                <div
                  className="flex w-full flex-col-reverse overflow-hidden rounded-md border border-subtle bg-background"
                  title={`${formatDay(run.date)}: ${run.total} runs`}
                  style={{ height: `${totalHeight}%` }}
                >
                  {segments.map((segment) => {
                    if (!segment.count) return null;
                    return (
                      <div
                        key={segment.key}
                        className={segment.className}
                        style={{
                          height: `${(segment.count / run.total) * 100}%`,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
              <span className="mt-2 truncate text-[11px] text-muted">
                {formatDay(run.date)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted">
        <LegendDot className="bg-emerald-500" label="Completed" />
        <LegendDot className="bg-red-500" label="Failed" />
        <LegendDot className="bg-sky-500" label="Running" />
        <LegendDot className="bg-amber-500" label="Cancelled" />
      </div>
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={cn('h-2.5 w-2.5 rounded-full', className)} />
      {label}
    </span>
  );
}

function StatusDistribution({ statuses }: { statuses: StatusBreakdown[] }) {
  if (!statuses.length) {
    return <EmptyState>No statuses recorded in this window.</EmptyState>;
  }

  return (
    <div className="space-y-4">
      {statuses.map((status) => (
        <div key={status.status} className="space-y-2">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="font-medium text-[var(--foreground)]">
              {formatStatus(status.status)}
            </span>
            <span className="text-muted">
              {formatNumber(status.count)} · {formatPercent(status.percent)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-background">
            <div
              className={cn(
                'h-full rounded-full',
                statusBarClass(status.status),
              )}
              style={{
                width: `${Math.max((status.percent ?? 0) * 100, 2)}%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ProviderTable({ providers }: { providers: ProviderBreakdown[] }) {
  if (!providers.length) {
    return <EmptyState>No providers have recorded runs yet.</EmptyState>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b border-subtle text-xs font-semibold uppercase tracking-wider text-muted">
          <tr>
            <th className="pb-3 pr-4">Provider</th>
            <th className="pb-3 pr-4">Runs</th>
            <th className="pb-3 pr-4">Success</th>
            <th className="pb-3 pr-4">Failed</th>
            <th className="pb-3 pr-4">Avg</th>
            <th className="pb-3 pr-4">P95</th>
            <th className="pb-3 pr-4">Errors</th>
            <th className="pb-3">Last run</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-subtle">
          {providers.map((provider) => (
            <tr key={provider.provider}>
              <td className="py-3 pr-4 font-medium text-[var(--foreground)]">
                {provider.provider}
              </td>
              <td className="py-3 pr-4">{formatNumber(provider.total)}</td>
              <td className="py-3 pr-4">
                {formatPercent(provider.successRate)}
              </td>
              <td className="py-3 pr-4 text-red-500">
                {formatNumber(provider.failed)}
              </td>
              <td className="py-3 pr-4">
                {formatDuration(provider.avgDurationMs)}
              </td>
              <td className="py-3 pr-4">
                {formatDuration(provider.p95DurationMs)}
              </td>
              <td className="py-3 pr-4">
                {formatNumber(provider.errorEvents)}
              </td>
              <td className="py-3 text-muted">
                {formatDate(provider.lastRunAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WorkflowTable({ workflows }: { workflows: WorkflowBreakdown[] }) {
  if (!workflows.length) {
    return <EmptyState>No workflows are stored for this workspace.</EmptyState>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead className="border-b border-subtle text-xs font-semibold uppercase tracking-wider text-muted">
          <tr>
            <th className="pb-3 pr-4">Workflow</th>
            <th className="pb-3 pr-4">Last status</th>
            <th className="pb-3 pr-4">Runs</th>
            <th className="pb-3 pr-4">Success</th>
            <th className="pb-3 pr-4">Avg</th>
            <th className="pb-3 pr-4">Nodes</th>
            <th className="pb-3 pr-4">Errors</th>
            <th className="pb-3">Last run</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-subtle">
          {workflows.map((workflow) => (
            <tr key={workflow.workflowId}>
              <td className="py-3 pr-4">
                <div className="font-medium text-[var(--foreground)]">
                  {workflow.title}
                </div>
                <div className="mt-1 text-xs text-muted">
                  {workflow.cloudProvider ?? 'No provider'} ·{' '}
                  {workflow.connectionCount} connections
                </div>
              </td>
              <td className="py-3 pr-4">
                <Badge variant={statusBadgeVariant(workflow.lastStatus)}>
                  {formatStatus(workflow.lastStatus)}
                </Badge>
              </td>
              <td className="py-3 pr-4">{formatNumber(workflow.total)}</td>
              <td className="py-3 pr-4">
                {formatPercent(workflow.successRate)}
              </td>
              <td className="py-3 pr-4">
                {formatDuration(workflow.avgDurationMs)}
              </td>
              <td className="py-3 pr-4">{formatNumber(workflow.nodeCount)}</td>
              <td className="py-3 pr-4 text-red-500">
                {formatNumber(workflow.errorEvents)}
              </td>
              <td className="py-3 text-muted">
                {formatDate(workflow.lastRunAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NodeTable({ nodes }: { nodes: NodeBreakdown[] }) {
  if (!nodes.length) {
    return <EmptyState>No node state events are stored yet.</EmptyState>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="border-b border-subtle text-xs font-semibold uppercase tracking-wider text-muted">
          <tr>
            <th className="pb-3 pr-4">Node</th>
            <th className="pb-3 pr-4">Workflow</th>
            <th className="pb-3 pr-4">Runs</th>
            <th className="pb-3 pr-4">Success</th>
            <th className="pb-3 pr-4">Errors</th>
            <th className="pb-3 pr-4">Running</th>
            <th className="pb-3">Last seen</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-subtle">
          {nodes.slice(0, 12).map((node) => (
            <tr key={`${node.workflowTitle}:${node.nodeId}`}>
              <td className="py-3 pr-4">
                <div className="font-medium text-[var(--foreground)]">
                  {node.label}
                </div>
                <div className="mt-1 text-xs text-muted">
                  {node.nodeType} · {shortId(node.nodeId)}
                </div>
              </td>
              <td className="py-3 pr-4 text-muted">{node.workflowTitle}</td>
              <td className="py-3 pr-4">{formatNumber(node.total)}</td>
              <td className="py-3 pr-4">{formatPercent(node.successRate)}</td>
              <td className="py-3 pr-4 text-red-500">
                {formatNumber(node.error)}
              </td>
              <td className="py-3 pr-4">{formatNumber(node.running)}</td>
              <td className="py-3 text-muted">{formatDate(node.lastSeenAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TopErrors({ errors }: { errors: TopError[] }) {
  if (!errors.length) {
    return <EmptyState>No error events in this window.</EmptyState>;
  }

  return (
    <div className="divide-y divide-subtle">
      {errors.map((error) => (
        <div key={error.message} className="py-3 first:pt-0 last:pb-0">
          <div className="flex items-start justify-between gap-4">
            <p className="min-w-0 flex-1 text-sm font-medium text-[var(--foreground)]">
              {error.message}
            </p>
            <Badge variant="danger">{formatNumber(error.count)}</Badge>
          </div>
          <p className="mt-2 text-xs text-muted">
            {formatNumber(error.affectedExecutions)} executions · last seen{' '}
            {formatDate(error.lastSeenAt)}
          </p>
        </div>
      ))}
    </div>
  );
}

function RecentErrors({ errors }: { errors: RecentError[] }) {
  if (!errors.length) {
    return <EmptyState>No recent error messages.</EmptyState>;
  }

  return (
    <div className="divide-y divide-subtle">
      {errors.map((error) => (
        <div key={error.id} className="py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="danger">
              {formatStatus(error.level ?? error.type)}
            </Badge>
            <span className="text-xs text-muted">
              {formatDate(error.occurredAt)}
            </span>
            <span className="text-xs text-muted">
              {error.cloudProvider ?? 'Unknown provider'}
            </span>
          </div>
          <p className="mt-2 text-sm font-medium text-[var(--foreground)]">
            {error.message}
          </p>
          <p className="mt-1 text-xs text-muted">
            {error.workflowTitle} · execution {shortId(error.executionId)}
            {error.nodeId ? ` · node ${shortId(error.nodeId)}` : ''}
          </p>
        </div>
      ))}
    </div>
  );
}

function RecentExecutions({ executions }: { executions: RecentExecution[] }) {
  if (!executions.length) {
    return <EmptyState>No executions in this window.</EmptyState>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead className="border-b border-subtle text-xs font-semibold uppercase tracking-wider text-muted">
          <tr>
            <th className="pb-3 pr-4">Execution</th>
            <th className="pb-3 pr-4">Status</th>
            <th className="pb-3 pr-4">Provider</th>
            <th className="pb-3 pr-4">Duration</th>
            <th className="pb-3 pr-4">Events</th>
            <th className="pb-3 pr-4">Started</th>
            <th className="pb-3">Output</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-subtle">
          {executions.map((execution) => (
            <tr key={execution.id}>
              <td className="py-3 pr-4">
                <div className="font-medium text-[var(--foreground)]">
                  {execution.workflowTitle}
                </div>
                <div className="mt-1 font-mono text-xs text-muted">
                  {shortId(execution.id)}
                </div>
              </td>
              <td className="py-3 pr-4">
                <Badge variant={statusBadgeVariant(execution.status)}>
                  {formatStatus(execution.status)}
                </Badge>
              </td>
              <td className="py-3 pr-4">{execution.cloudProvider}</td>
              <td className="py-3 pr-4">
                {formatDuration(execution.durationMs)}
              </td>
              <td className="py-3 pr-4">
                {formatNumber(execution.eventCount)}
                {execution.errorEvents ? (
                  <span className="ml-2 text-red-500">
                    {formatNumber(execution.errorEvents)} errors
                  </span>
                ) : null}
              </td>
              <td className="py-3 pr-4 text-muted">
                {formatDate(execution.startedAt)}
              </td>
              <td className="py-3">
                {execution.reportUrl ? (
                  <a
                    href={execution.reportUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-[var(--foreground)] hover:text-muted"
                  >
                    Report
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span className="text-xs text-muted">N/A</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EventTypes({ eventTypes }: { eventTypes: EventTypeBreakdown[] }) {
  if (!eventTypes.length) {
    return <EmptyState>No events recorded in this window.</EmptyState>;
  }

  return (
    <div className="space-y-3">
      {eventTypes.map((eventType) => (
        <div
          key={`${eventType.type}:${eventType.level ?? ''}`}
          className="flex items-center justify-between gap-4 text-sm"
        >
          <div className="min-w-0">
            <p className="truncate font-medium text-[var(--foreground)]">
              {eventType.type}
            </p>
            <p className="text-xs text-muted">
              {eventType.level ?? 'no level'}
            </p>
          </div>
          <Badge variant={eventType.level === 'error' ? 'danger' : 'outline'}>
            {formatNumber(eventType.count)}
          </Badge>
        </div>
      ))}
    </div>
  );
}

function WorkspaceInventory({ workspace }: { workspace: Workspace }) {
  const rows = [
    {
      detail: workspace.projects.map((project) => project.title).join(', '),
      label: 'Projects',
      value: workspace.projects.length,
    },
    {
      detail: workspace.integrations
        .map((integration) => integration.provider)
        .join(', '),
      label: 'Integrations',
      value: workspace.integrations.length,
    },
    {
      detail: workspace.cloudCredentials
        .map((credential) => credential.provider)
        .join(', '),
      label: 'Cloud credentials',
      value: workspace.cloudCredentials.length,
    },
    {
      detail: workspace.environments
        .map((environment) => environment.name)
        .join(', '),
      label: 'Environments',
      value: workspace.environments.length,
    },
    {
      detail: workspace.secrets.lastUpdatedAt
        ? `Updated ${formatDate(workspace.secrets.lastUpdatedAt)}`
        : 'No secret updates',
      label: 'Secrets',
      value: workspace.secrets.count,
    },
  ];

  return (
    <div className="divide-y divide-subtle">
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
        >
          <div className="min-w-0">
            <p className="font-medium text-[var(--foreground)]">{row.label}</p>
            <p className="truncate text-xs text-muted">
              {row.detail || 'None'}
            </p>
          </div>
          <span className="text-lg font-semibold tracking-tight">
            {formatNumber(row.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <div
          key={index}
          className="h-32 animate-pulse rounded-xl border border-subtle bg-surface"
        />
      ))}
    </div>
  );
}

export default function Insights() {
  const [range, setRange] = useState<InsightRange>('30');
  const [report, setReport] = useState<InsightsPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadInsights = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const nextReport = (await DbAPI.getInsights(range)) as InsightsPayload;
      setReport(nextReport);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Failed to load insights.',
      );
    } finally {
      setIsLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void loadInsights();
  }, [loadInsights]);

  const topWorkflowCount = report?.workflowBreakdown.filter(
    (workflow) => workflow.total > 0,
  ).length;
  const latestDay = useMemo(() => report?.dailyRuns.at(-1), [report]);

  return (
    <main className="flex-1 bg-background p-8 text-[var(--foreground)]">
      <div className="mx-auto max-w-7xl space-y-8 pb-16">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-subtle pb-6">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight">Insights</h2>
            <p className="mt-2 text-sm text-muted">
              Workflow, execution, event, and workspace insights from stored
              data.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-subtle bg-surface p-1">
              {rangeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setRange(option.value)}
                  className={cn(
                    'h-8 rounded-md px-3 text-xs font-medium transition-colors',
                    range === option.value
                      ? 'bg-background text-[var(--foreground)] shadow-sm'
                      : 'text-muted hover:text-[var(--foreground)]',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void loadInsights()}
              disabled={isLoading}
            >
              <RefreshCw
                className={cn('mr-2 h-3.5 w-3.5', isLoading && 'animate-spin')}
              />
              Refresh
            </Button>
          </div>
        </header>

        {error ? (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-500">
            {error}
          </div>
        ) : null}

        {!report && isLoading ? <LoadingState /> : null}

        {report ? (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                helper={`${formatNumber(report.summary.completed)} completed, ${formatNumber(report.summary.failed)} failed`}
                icon={Activity}
                label="Executions"
                value={formatNumber(report.summary.total)}
              />
              <MetricCard
                helper={`${report.window.label} terminal completion rate`}
                icon={CheckCircle2}
                label="Success Rate"
                tone="success"
                value={formatPercent(report.summary.successRate)}
              />
              <MetricCard
                helper={`P95 ${formatDuration(report.summary.p95DurationMs)}`}
                icon={Clock3}
                label="Avg Duration"
                value={formatDuration(report.summary.avgDurationMs)}
              />
              <MetricCard
                helper={`${formatNumber(report.summary.errorEvents)} error-class events`}
                icon={AlertTriangle}
                label="Failure Rate"
                tone={report.summary.failed ? 'danger' : 'default'}
                value={formatPercent(report.summary.failureRate)}
              />
              <MetricCard
                helper={`${formatNumber(report.summary.nodeCount)} nodes, ${formatNumber(report.summary.connectionCount)} connections`}
                icon={Workflow}
                label="Workflows"
                value={formatNumber(report.summary.workflowCount)}
              />
              <MetricCard
                helper={`${formatNumber(topWorkflowCount ?? 0)} with recorded runs`}
                icon={Gauge}
                label="Active Runs"
                value={formatNumber(report.summary.running)}
              />
              <MetricCard
                helper={`${formatNumber(report.summary.integrationCount)} integrations, ${formatNumber(report.summary.cloudCredentialCount)} cloud credentials`}
                icon={Cloud}
                label="Connections"
                value={formatNumber(
                  report.summary.integrationCount +
                    report.summary.cloudCredentialCount,
                )}
              />
              <MetricCard
                helper={`Latest run ${formatDate(report.summary.latestExecutionAt)}`}
                icon={Database}
                label="Events"
                value={formatCompactNumber(report.summary.totalEvents)}
              />
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
              <Section
                eyebrow={report.window.label}
                title="Execution Volume"
                action={
                  latestDay ? (
                    <Badge variant="outline">
                      {formatNumber(latestDay.total)} latest-day runs
                    </Badge>
                  ) : null
                }
              >
                <DailyRunsChart runs={report.dailyRuns} />
              </Section>

              <Section title="Status Mix">
                <StatusDistribution statuses={report.statusBreakdown} />
              </Section>
            </div>

            <Section title="Cloud Provider Performance">
              <ProviderTable providers={report.providerBreakdown} />
            </Section>

            <Section title="Workflow Health">
              <WorkflowTable workflows={report.workflowBreakdown} />
            </Section>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <Section title="Node Reliability">
                <NodeTable nodes={report.nodeBreakdown} />
              </Section>

              <Section title="Event Types">
                <EventTypes eventTypes={report.eventTypes} />
              </Section>
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <Section title="Top Error Messages">
                <TopErrors errors={report.topErrors} />
              </Section>

              <Section title="Recent Errors">
                <RecentErrors errors={report.recentErrors} />
              </Section>
            </div>

            <Section title="Recent Executions">
              <RecentExecutions executions={report.recentExecutions} />
            </Section>

            <Section
              title="Workspace Inventory"
              action={
                <span className="text-xs text-muted">
                  Generated {formatDate(report.generatedAt)}
                </span>
              }
            >
              <WorkspaceInventory workspace={report.workspace} />
            </Section>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <MetricCard
                helper={`${formatNumber(report.summary.projectCount)} projects stored`}
                icon={FileText}
                label="Projects"
                value={formatNumber(report.summary.projectCount)}
              />
              <MetricCard
                helper={`${formatNumber(report.summary.environmentCount)} environment records`}
                icon={Server}
                label="Environments"
                value={formatNumber(report.summary.environmentCount)}
              />
              <MetricCard
                helper={`${formatNumber(report.summary.secretCount)} secret metadata rows`}
                icon={CalendarDays}
                label="Secrets"
                value={formatNumber(report.summary.secretCount)}
              />
            </div>
          </>
        ) : null}

        {report && !report.summary.total && !isLoading ? (
          <EmptyState>
            Saved workflows and workspace configuration are available, but no
            executions have been stored in this window.
          </EmptyState>
        ) : null}

        {isLoading && report ? (
          <div className="fixed bottom-4 right-4 rounded-lg border border-subtle bg-surface px-3 py-2 text-xs text-muted shadow-sm">
            Refreshing insights...
          </div>
        ) : null}
      </div>
    </main>
  );
}
