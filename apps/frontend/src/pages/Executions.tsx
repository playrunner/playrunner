import { TestProgressBar } from '../components/TestProgressBar';
import type { TestProgress } from '../../../runners/shared/test-progress';
import { useEffect, useState, type ReactNode } from 'react';
import { NodeTypeIcon } from '../components/NodeTypeIcon';
import {
  RunnerResources,
  NodeResources,
  HostLoad,
} from '../components/RunnerResources';
import type { RunnerResourceSnapshot } from '../../../runners/shared/runner-resources';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  Ban,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Clock,
  FileText,
  LoaderCircle,
  SkipForward,
  XCircle,
} from 'lucide-react';
import { Badge, Button, Select } from '../components/ui';
import { auth } from '../lib/auth';
import { openAuthenticatedOutput } from '../lib/output-links';

type Execution = {
  id: string;
  workflowId: string | null;
  title: string;
  projectTitle: string | null;
  status: string;
  testPlanReportUrl?: string | null;
  activityStale: boolean;
  lastActivityAt: string;
  startedAt: string;
  completedAt: string | null;
  cloudProvider: string;
  nodes: Array<{
    id: string;
    title: string;
    type: string;
    status: string;
    reportUrl: string | null;
    progress?: TestProgress | null;
    parentNodeId?: string | null;
  }>;
};
const variant = (status: string) =>
  status === 'failed'
    ? 'danger'
    : ['succeeded', 'completed'].includes(status)
      ? 'success'
      : 'outline';

export default function Executions() {
  const [collapsedExecutions, setCollapsedExecutions] = useState<Set<string>>(
    new Set(),
  );
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [resources, setResources] = useState<RunnerResourceSnapshot | null>(
    null,
  );
  const [connection, setConnection] = useState('Connecting');
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [recentPage, setRecentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [recentPagination, setRecentPagination] = useState({
    page: 1,
    pageSize: 10,
    total: 0,
  });
  useEffect(() => {
    let closed = false;
    const query = new URLSearchParams({
      page: String(recentPage),
      pageSize: String(pageSize),
    });
    const applyPagination = (recent: {
      page: number;
      pageSize: number;
      total: number;
    }) => {
      setRecentPagination(recent);
      setRecentPage(
        Math.min(
          recent.page,
          Math.max(1, Math.ceil(recent.total / recent.pageSize)),
        ),
      );
    };
    let stream: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let lastMessage = Date.now();
    let refreshing = false;
    let snapshotVersion = 0;
    let connectionVersion = 0;
    const refreshSnapshot = async () => {
      if (closed || refreshing || !navigator.onLine) return;
      refreshing = true;
      const version = snapshotVersion;
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token || closed) return;
        const response = await fetch(`/api/executions/live?${query}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) return;
        const snapshot = await response.json();
        // An event received during this request is newer than this snapshot.
        if (
          closed ||
          version !== snapshotVersion ||
          !Array.isArray(snapshot.executions)
        )
          return;
        setExecutions(snapshot.executions);
        applyPagination(snapshot.recent);
        setResources(snapshot.resources ?? null);
        snapshotVersion++;
      } catch {
        /* The stream watchdog continues reconnecting independently. */
      } finally {
        refreshing = false;
      }
    };
    const connect = async () => {
      const version = ++connectionVersion;
      clearTimeout(retry);
      stream?.close();
      if (!navigator.onLine) {
        reconnect();
        return;
      }
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error('Sign in to view executions.');
        const response = await fetch(`/api/executions/live?${query}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok)
          throw new Error(
            response.status === 401
              ? 'Your session has expired. Sign in again.'
              : 'Execution service unavailable. Retrying automatically.',
          );
        const snapshot = await response.json();
        if (closed || version !== connectionVersion) return;
        setExecutions(snapshot.executions);
        applyPagination(snapshot.recent);
        setResources(snapshot.resources ?? null);
        snapshotVersion++;
        lastMessage = Date.now();
        stream = new EventSource(
          `/api/executions/live/stream?${query}&token=${encodeURIComponent(token)}`,
        );
        stream.onmessage = (event) => {
          if (closed || version !== connectionVersion) return;
          try {
            const data = JSON.parse(event.data);
            if (!Array.isArray(data.executions))
              throw new Error('Invalid execution snapshot.');
            setExecutions(data.executions);
            applyPagination(data.recent);
            setResources(data.resources ?? null);
            snapshotVersion++;
            setConnection('Live');
            setError('');
            lastMessage = Date.now();
          } catch {
            reconnect();
          }
        };
        stream.onerror = () => {
          if (version === connectionVersion) reconnect();
        };
      } catch (cause) {
        if (closed || version !== connectionVersion) return;
        setError(
          cause instanceof Error
            ? cause.message
            : 'Cannot connect to execution service.',
        );
        reconnect();
      }
    };
    const reconnect = () => {
      if (closed) return;
      connectionVersion++;
      stream?.close();
      setConnection('Reconnecting');
      clearTimeout(retry);
      retry = setTimeout(() => {
        void connect();
      }, 2000);
    };
    const timer = setInterval(() => {
      setNow(Date.now());
      if (stream && Date.now() - lastMessage > 15000) {
        lastMessage = Date.now();
        reconnect();
      }
    }, 1000);
    const offline = () => {
      stream?.close();
      reconnect();
    };
    const online = () => {
      clearTimeout(retry);
      void connect();
    };
    const visible = () => {
      if (document.visibilityState === 'visible') {
        void refreshSnapshot();
        online();
      }
    };
    // Reconcile even if a proxy leaves an apparently open but stale stream.
    const snapshotTimer = setInterval(() => {
      void refreshSnapshot();
    }, 10000);
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    void connect();
    return () => {
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
      closed = true;
      clearInterval(timer);
      clearInterval(snapshotTimer);
      clearTimeout(retry);
      stream?.close();
    };
  }, [recentPage, pageSize]);
  const renderExecution = (execution: Execution) => {
    const collapsed = collapsedExecutions.has(execution.id);
    const detailsId = `execution-${execution.id}-details`;
    const childrenByParent = new Map<string, Execution['nodes']>();
    const nodeIds = new Set(execution.nodes.map((node) => node.id));
    for (const node of execution.nodes) {
      if (!node.parentNodeId || !nodeIds.has(node.parentNodeId)) continue;
      const siblings = childrenByParent.get(node.parentNodeId) ?? [];
      siblings.push(node);
      childrenByParent.set(node.parentNodeId, siblings);
    }
    const rootNodes = execution.nodes.filter(
      (node) => !node.parentNodeId || !nodeIds.has(node.parentNodeId),
    );
    const renderNode = (node: Execution['nodes'][number]): ReactNode => {
      const children = childrenByParent.get(node.id) ?? [];
      const key = JSON.stringify([execution.id, node.id]);
      const expanded = expandedNodes.has(key);
      const childrenId = `execution-${execution.id}-node-${node.id}-children`;
      return (
        <li key={node.id} aria-label={node.title} className="space-y-2">
          <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 rounded-lg border border-subtle bg-background p-3">
            <div className="flex items-center gap-3 min-w-0 flex-1 basis-full sm:basis-auto">
              <span
                aria-hidden="true"
                className={`w-1 self-stretch rounded-full ${node.status === 'running' && !execution.activityStale ? 'bg-[var(--accent)] animate-pulse' : node.status === 'failed' ? 'bg-red-500' : node.status === 'succeeded' ? 'bg-emerald-500' : 'bg-[var(--border-strong)]'}`}
              />
              {children.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.title}`}
                  aria-expanded={expanded}
                  aria-controls={childrenId}
                  onClick={() =>
                    setExpandedNodes((current) => {
                      const next = new Set(current);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    })
                  }
                >
                  <ChevronRight
                    aria-hidden="true"
                    className={`h-4 w-4 transition-transform ${expanded ? 'rotate-90' : ''}`}
                  />
                </Button>
              )}
              <NodeTypeIcon type={node.type} />
              <div className="min-w-0 space-y-2 w-full">
                <span className="block text-sm truncate" title={node.title}>
                  {node.title}
                </span>
                <TestProgressBar
                  showActivity
                  progress={node.progress}
                  status={node.status}
                  type={node.type}
                  stale={connection !== 'Live' || execution.activityStale}
                />
                {connection === 'Live' &&
                  resources?.available &&
                  now - Date.parse(resources.sampledAt) < 15000 && (
                    <NodeResources
                      runners={resources.runners.filter(
                        (runner) =>
                          runner.executionId === execution.id &&
                          runner.nodeId === node.id,
                      )}
                    />
                  )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={variant(node.status)}>
                {execution.activityStale && node.status === 'running'
                  ? 'Last reported running'
                  : node.status}
              </Badge>
              {node.reportUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void openAuthenticatedOutput(node.reportUrl!)}
                >
                  <FileText className="w-4 h-4" />
                  Report
                </Button>
              )}
            </div>
          </div>
          {children.length > 0 && (
            <ul
              id={childrenId}
              aria-label={`${node.title} child processes`}
              hidden={!expanded}
              className="ml-4 sm:ml-8 pl-3 border-l border-subtle space-y-2"
            >
              {children.map(renderNode)}
            </ul>
          )}
        </li>
      );
    };
    return (
      <section
        key={execution.id}
        id={execution.id}
        aria-label={`Execution ${execution.id}`}
        className="bg-surface border border-subtle rounded-xl shadow-sm p-5 space-y-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 basis-full sm:basis-auto items-start gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              aria-label={`${collapsed ? 'Expand' : 'Collapse'} execution ${execution.title}`}
              aria-expanded={!collapsed}
              aria-controls={detailsId}
              onClick={() =>
                setCollapsedExecutions((current) => {
                  const next = new Set(current);
                  if (next.has(execution.id)) next.delete(execution.id);
                  else next.add(execution.id);
                  return next;
                })
              }
            >
              <ChevronRight
                aria-hidden="true"
                className={`h-4 w-4 transition-transform ${collapsed ? '' : 'rotate-90'}`}
              />
            </Button>
            <div className="min-w-0 break-words">
              <h2 className="text-xl font-medium">{execution.title}</h2>
              <p className="text-sm text-muted">
                {execution.projectTitle && `${execution.projectTitle} · `}
                {execution.cloudProvider} ·{' '}
                {Math.max(
                  0,
                  Math.floor(
                    ((execution.completedAt
                      ? Date.parse(execution.completedAt)
                      : execution.activityStale
                        ? Date.parse(execution.lastActivityAt)
                        : now) -
                      Date.parse(execution.startedAt)) /
                      1000,
                  ),
                )}
                {execution.activityStale ? 's until last update' : 's'} ·{' '}
                {new Date(execution.startedAt).toLocaleString()}
              </p>
            </div>
          </div>
          <Badge
            variant={
              execution.activityStale ? 'outline' : variant(execution.status)
            }
          >
            {execution.activityStale ? 'Status unconfirmed' : execution.status}
          </Badge>
        </div>
        {collapsed && rootNodes.length > 0 && (
          <ul aria-label="Node status summary" className="flex flex-wrap gap-3">
            {rootNodes.map((node) => {
              const stale =
                node.status === 'running' &&
                (execution.activityStale || connection !== 'Live');
              const status = stale ? 'Last reported running' : node.status;
              const StatusIcon = stale
                ? AlertCircle
                : node.status === 'running'
                  ? LoaderCircle
                  : ['succeeded', 'completed'].includes(node.status)
                    ? CheckCircle2
                    : node.status === 'failed'
                      ? XCircle
                      : node.status === 'cancelled'
                        ? Ban
                        : node.status === 'skipped'
                          ? SkipForward
                          : ['pending', 'queued'].includes(node.status)
                            ? Clock
                            : CircleDashed;
              return (
                <li
                  key={node.id}
                  aria-label={`${node.title}: ${status}`}
                  title={`${node.title}: ${status}`}
                  tabIndex={0}
                  className="relative flex h-11 w-11 items-center justify-center rounded-lg border border-subtle bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-strong)]"
                >
                  <NodeTypeIcon type={node.type} />
                  <StatusIcon
                    aria-hidden="true"
                    className={`absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-background ${stale ? 'text-muted' : node.status === 'failed' ? 'text-red-500' : ['succeeded', 'completed'].includes(node.status) ? 'text-emerald-500' : node.status === 'running' ? 'text-[var(--accent)] motion-safe:animate-spin' : 'text-muted'}`}
                  />
                  <span className="sr-only">{`${node.title}: ${status}`}</span>
                </li>
              );
            })}
          </ul>
        )}
        {!execution.nodes.length && (
          <p className="text-sm text-muted">Waiting for node events.</p>
        )}
        <div id={detailsId} hidden={collapsed} className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-mono text-xs text-muted break-all">
              {execution.id}
            </p>
            {execution.testPlanReportUrl && (
              <Link
                className="text-sm underline"
                to={execution.testPlanReportUrl}
              >
                Test plan report
              </Link>
            )}
            {execution.workflowId && (
              <Link
                className="text-sm underline"
                to={`/workflow/${encodeURIComponent(execution.workflowId)}`}
              >
                Open workflow
              </Link>
            )}
          </div>
          {execution.activityStale && (
            <p className="flex items-start gap-2 text-sm text-muted">
              <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
              No recent updates—status unconfirmed. No events received since{' '}
              {new Date(execution.lastActivityAt).toLocaleString()}. Last
              reported as running; the current status is unconfirmed.
            </p>
          )}
          <ul className="space-y-2">{rootNodes.map(renderNode)}</ul>
        </div>
      </section>
    );
  };
  const active = executions.filter((e) => e.status === 'running');
  const recent = executions.filter((e) => e.status !== 'running');
  const recentPages = Math.max(1, Math.ceil(recentPagination.total / pageSize));
  const changingPage =
    recentPagination.page !== recentPage ||
    recentPagination.pageSize !== pageSize;

  return (
    <div className="max-w-7xl mx-auto p-6 md:p-8 w-full space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-subtle pb-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Live executions
          </h1>
          <p className="text-sm text-muted leading-relaxed mt-2">
            All unfinished workflows and paginated recent runs. Runs stay
            visible until a final outcome is confirmed.
          </p>
        </div>
        <Badge variant={connection === 'Live' ? 'success' : 'outline'}>
          <Activity className="w-4 h-4" aria-hidden="true" />
          {connection}
        </Badge>
      </header>
      {connection !== 'Live' && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted">
          <AlertCircle className="w-4 h-4" />
          {error ||
            (connection === 'Connecting'
              ? 'Connecting to execution service…'
              : 'Connection interrupted. Displayed results may be stale.')}
        </p>
      )}
      {connection === 'Live' && !executions.length && (
        <p className="text-sm text-muted">
          No executions yet. Start a workflow to see its progress here.
        </p>
      )}
      <RunnerResources
        snapshot={resources}
        live={connection === 'Live'}
        now={now}
      />
      <HostLoad snapshot={resources} live={connection === 'Live'} now={now} />
      {active.length > 0 && (
        <section aria-label="Active runs" className="space-y-4">
          <h2 className="text-xl font-medium">Active runs</h2>
          {active.map(renderExecution)}
        </section>
      )}
      {recentPagination.total > 0 && (
        <section
          aria-label="Recent runs"
          className="space-y-4"
          aria-busy={changingPage}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-xl font-medium">Recent runs</h2>
            <label className="flex items-center gap-2 whitespace-nowrap text-sm text-muted">
              Runs per page
              <Select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setRecentPage(1);
                }}
              >
                {[10, 25, 50].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <nav
            aria-label="Recent runs pagination"
            className="flex flex-wrap items-center justify-between gap-3"
          >
            <p className="text-sm text-muted" aria-live="polite">
              Page {recentPage} of {recentPages} · {recentPagination.total} runs
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={changingPage || recentPage <= 1}
                onClick={() => setRecentPage((page) => page - 1)}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                disabled={changingPage || recentPage >= recentPages}
                onClick={() => setRecentPage((page) => page + 1)}
              >
                Next
              </Button>
            </div>
          </nav>
          {changingPage ? (
            <p className="text-sm text-muted">Loading recent runs…</p>
          ) : (
            recent.map(renderExecution)
          )}
        </section>
      )}
    </div>
  );
}
