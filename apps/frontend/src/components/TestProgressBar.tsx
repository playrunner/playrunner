import type { TestProgress } from '../../../runners/shared/test-progress';

export function TestProgressBar({
  progress,
  status,
  type,
  stale,
}: {
  progress?: TestProgress | null;
  status: string;
  type: string;
  stale: boolean;
}) {
  if (!progress)
    return type === 'playwright' && status === 'running' ? (
      <p className="text-xs text-muted">Waiting for test discovery…</p>
    ) : null;
  const percent = progress.total
    ? Math.floor((progress.completed / progress.total) * 100)
    : 0;
  return (
    <div className="space-y-1 max-w-xl">
      <div className="flex flex-wrap justify-between gap-x-4 text-xs text-muted">
        <span>
          {progress.completed} / {progress.total} tests completed · {percent}%
          {stale && status === 'running' ? ' · Last reported' : ''}
        </span>
        <span>{progress.total - progress.completed} remaining</span>
      </div>
      <div
        role="progressbar"
        aria-label="Tests completed"
        aria-valuemin={0}
        aria-valuemax={progress.total || 1}
        aria-valuenow={progress.completed}
        className="h-2 overflow-hidden rounded-full bg-surface-hover flex"
      >
        <div
          className="bg-emerald-500 transition-all"
          style={{
            width: `${progress.total ? (progress.passed / progress.total) * 100 : 0}%`,
          }}
        />
        <div
          className="bg-red-500 transition-all"
          style={{
            width: `${progress.total ? (progress.failed / progress.total) * 100 : 0}%`,
          }}
        />
        <div
          className="bg-[var(--border-strong)] transition-all"
          style={{
            width: `${progress.total ? (progress.skipped / progress.total) * 100 : 0}%`,
          }}
        />
      </div>
      <p className="text-xs text-muted">
        {progress.passed} passed · {progress.failed} failed · {progress.skipped}{' '}
        skipped{status === 'running' ? ` · ${progress.running} running` : ''}
      </p>
    </div>
  );
}
