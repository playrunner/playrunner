import { Loader2, TerminalSquare } from 'lucide-react';

export interface TunnelViewState {
  error?: string;
  logs?: string[];
  message?: string;
  status: string;
  url: string;
}

export function TunnelStatusConsole({ tunnel }: { tunnel: TunnelViewState }) {
  const isStarting = tunnel.status === 'starting';
  if (
    tunnel.status === 'stopped' &&
    !tunnel.error &&
    !(tunnel.logs?.length ?? 0)
  ) {
    return null;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-hover)]">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        {isStarting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />
        ) : (
          <TerminalSquare className="h-3.5 w-3.5 text-muted" />
        )}
        <span className="text-xs font-medium text-[var(--foreground)]">
          {tunnel.message || `Tunnel ${tunnel.status}`}
        </span>
      </div>
      <pre
        aria-live="polite"
        className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-relaxed text-muted"
      >
        {(tunnel.logs?.length
          ? tunnel.logs
          : [tunnel.error || tunnel.message || 'Waiting for status…']
        ).join('\n')}
      </pre>
    </div>
  );
}
