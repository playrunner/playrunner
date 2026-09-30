import { useState } from 'react';
import { Activity, AlertCircle, Square } from 'lucide-react';
import { Button, ConfirmDialog } from './ui';
import { auth } from '../lib/auth';

type Check = {
  state: string;
  status?: string;
  runnerCount?: number | null;
  checkedAt: string;
};
const describe = (check: Check) => {
  switch (check.state) {
    case 'running':
      return 'Orchestrator is tracking this run. This does not confirm test progress.';
    case 'stopping':
      return 'Stop requested. Waiting for the workflow to finish stopping; check again shortly.';
    case 'inactive':
      return 'No active workflow or runner containers found. Stop run to close this unfinished record.';
    case 'orphaned':
      return 'Runner containers remain, but the orchestrator no longer tracks this run. Stop run to terminate them.';
    case 'finished':
      return `Run is ${check.status}.`;
    default:
      return 'Status unconfirmed. The local orchestrator or Docker could not be reached. Restart the local API if the orchestrator needs updating.';
  }
};

export function ExecutionControls({
  id,
  title,
  lastActivityAt,
  now,
  local,
}: {
  id: string;
  title: string;
  lastActivityAt: string;
  now: number;
  local: boolean;
}) {
  const [pending, setPending] = useState<'check' | 'stop' | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const act = async (action: 'check' | 'stop') => {
    if (pending) return;
    setConfirm(false);
    setPending(action);
    setError('');
    setCheck(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Sign in to manage this run.');
      const response = await fetch(
        `/api/executions/${encodeURIComponent(id)}/${action}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(60000),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || 'The request failed. Try again.');
      setCheck(result);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.name !== 'TimeoutError'
          ? cause.message
          : 'No response received. Check activity before retrying; the stop request may still be in progress.',
      );
    } finally {
      setPending(null);
    }
  };
  const seconds = Math.max(
    0,
    Math.floor((now - Date.parse(lastActivityAt)) / 1000),
  );
  const age =
    seconds < 60
      ? `${seconds}s`
      : seconds < 3600
        ? `${Math.floor(seconds / 60)}m`
        : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <p
          className="text-sm text-muted"
          title={new Date(lastActivityAt).toLocaleString()}
        >
          Last event {age} ago
        </p>
        {local && (
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={!!pending}
              onClick={() => void act('check')}
            >
              <Activity className="h-4 w-4" aria-hidden="true" />
              {pending === 'check' ? 'Checking…' : 'Check activity'}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={!!pending || check?.state === 'finished'}
              onClick={() => setConfirm(true)}
            >
              <Square className="h-4 w-4" aria-hidden="true" />
              {pending === 'stop' ? 'Stopping…' : 'Stop run'}
            </Button>
          </>
        )}
      </div>
      {check && (
        <p role="status" className="flex items-start gap-2 text-sm text-muted">
          <Activity className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {describe(check)}
            {check.runnerCount != null
              ? ` ${check.runnerCount} runner container${check.runnerCount === 1 ? '' : 's'} found.`
              : ''}{' '}
            Checked at {new Date(check.checkedAt).toLocaleTimeString()}.
            {now - Date.parse(check.checkedAt) > 30000 &&
              ' This check is out of date; check again for current activity.'}
          </span>
        </p>
      )}
      {error && (
        <p role="alert" className="flex items-start gap-2 text-sm text-muted">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
      <ConfirmDialog
        isOpen={confirm}
        title="Stop this run?"
        description={`Stop “${title}” and its runners? Remaining workflow steps will not start. An inactive run will be marked cancelled.`}
        confirmLabel="Stop run"
        onConfirm={() => void act('stop')}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}
