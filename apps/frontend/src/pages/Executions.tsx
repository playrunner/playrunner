import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertCircle, FileText } from 'lucide-react';
import { Badge, Button } from '../components/ui';
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
    status: string;
    reportUrl: string | null;
  }>;
};
const variant = (status: string) =>
  status === 'failed'
    ? 'danger'
    : ['succeeded', 'completed'].includes(status)
      ? 'success'
      : 'outline';

export default function Executions() {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [connection, setConnection] = useState('Connecting');
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let closed = false;
    let stream: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let lastMessage = Date.now();
    const connect = async () => {
      stream?.close();
      if (!navigator.onLine) {
        reconnect();
        return;
      }
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error('Sign in to view executions.');
        const response = await fetch('/api/executions/live', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok)
          throw new Error(
            response.status === 401
              ? 'Your session has expired. Sign in again.'
              : 'Execution service unavailable. Retrying automatically.',
          );
        const snapshot = await response.json();
        if (closed) return;
        setExecutions(snapshot.executions);
        stream = new EventSource(
          `/api/executions/live/stream?token=${encodeURIComponent(token)}`,
        );
        stream.onmessage = (event) => {
          if (closed) return;
          try {
            const data = JSON.parse(event.data);
            if (!Array.isArray(data.executions))
              throw new Error('Invalid execution snapshot.');
            setExecutions(data.executions);
            setConnection('Live');
            setError('');
            lastMessage = Date.now();
          } catch {
            reconnect();
          }
        };
        stream.onerror = reconnect;
      } catch (cause) {
        if (closed) return;
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
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    void connect();
    return () => {
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      closed = true;
      clearInterval(timer);
      clearTimeout(retry);
      stream?.close();
    };
  }, []);
  const renderExecution = (execution: Execution) => (
    <section
      key={execution.id}
      id={execution.id}
      aria-label={`Execution ${execution.id}`}
      className="bg-surface border border-subtle rounded-xl shadow-sm p-5 space-y-4"
    >
      <div className="flex flex-wrap justify-between gap-3">
        <div>
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
          <p className="font-mono text-xs text-muted mt-1">{execution.id}</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge
            variant={
              execution.activityStale ? 'outline' : variant(execution.status)
            }
          >
            {execution.activityStale ? 'Status unconfirmed' : execution.status}
          </Badge>
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
      </div>
      {execution.activityStale && (
        <p className="flex items-start gap-2 text-sm text-muted">
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
          No events received since{' '}
          {new Date(execution.lastActivityAt).toLocaleString()}. Last reported
          as running; the current status is unconfirmed.
        </p>
      )}
      {!execution.nodes.length && (
        <p className="text-sm text-muted">Waiting for node events.</p>
      )}
      <ul className="space-y-2">
        {execution.nodes.map((node) => (
          <li
            key={node.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-subtle bg-background p-3"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span
                aria-hidden="true"
                className={`w-1 self-stretch rounded-full ${node.status === 'running' && !execution.activityStale ? 'bg-[var(--accent)] animate-pulse' : node.status === 'failed' ? 'bg-red-500' : node.status === 'succeeded' ? 'bg-emerald-500' : 'bg-[var(--border-strong)]'}`}
              />
              <span className="text-sm truncate">{node.title}</span>
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
          </li>
        ))}
      </ul>
    </section>
  );
  const active = executions.filter(
    (e) => e.status === 'running' && !e.activityStale,
  );
  const recent = executions.filter((e) => e.status !== 'running');
  const unconfirmed = executions.filter((e) => e.activityStale);

  return (
    <div className="max-w-7xl mx-auto p-6 md:p-8 w-full space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-subtle pb-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Live executions
          </h1>
          <p className="text-sm text-muted leading-relaxed mt-2">
            Active workflows and the latest 30 finished runs. Older runs with no
            recent updates are listed separately.
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
      {active.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-medium">Active runs</h2>
          {active.map(renderExecution)}
        </div>
      )}
      {recent.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-medium">Recent runs</h2>
          {recent.map(renderExecution)}
        </div>
      )}
      {unconfirmed.length > 0 && (
        <details className="space-y-4">
          <summary className="cursor-pointer text-sm text-muted">
            No recent updates ({unconfirmed.length} executions)
          </summary>
          <p className="text-sm text-muted">
            These executions have not sent an event for over five minutes. Their
            last reported states are shown below; silence does not confirm that
            a run has stopped or failed.
          </p>
          {unconfirmed.map(renderExecution)}
        </details>
      )}
    </div>
  );
}
