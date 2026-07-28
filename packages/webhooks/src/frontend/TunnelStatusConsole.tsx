import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Loader2, TerminalSquare } from 'lucide-react';

export interface TunnelViewState {
  error?: string;
  logs?: string[];
  message?: string;
  status: string;
  url: string;
}

export function TunnelStatusConsole({ tunnel }: { tunnel: TunnelViewState }) {
  const isStarting = tunnel.status === 'starting';
  const output = (
    tunnel.logs?.length
      ? tunnel.logs
      : [tunnel.error || tunnel.message || 'Waiting for status…']
  ).join('\n');
  const [copied, setCopied] = useState(false);
  const consoleRef = useRef<HTMLPreElement>(null);
  const autoScrollRef = useRef(true);
  const previousStatusRef = useRef(tunnel.status);

  useEffect(() => {
    const isNewStartup =
      tunnel.status === 'starting' && previousStatusRef.current !== 'starting';

    if (isNewStartup) {
      autoScrollRef.current = true;
    }
    previousStatusRef.current = tunnel.status;

    if (autoScrollRef.current && consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [tunnel.error, tunnel.logs, tunnel.message, tunnel.status]);

  const handleScroll = useCallback(() => {
    const consoleElement = consoleRef.current;
    if (!consoleElement) return;

    const distanceFromBottom =
      consoleElement.scrollHeight -
      consoleElement.scrollTop -
      consoleElement.clientHeight;
    autoScrollRef.current = distanceFromBottom < 10;
  }, []);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

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
        <button
          aria-label={copied ? 'Copied' : 'Copy console output'}
          className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--background)] text-muted transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
          onClick={handleCopy}
          title="Copy console output"
          type="button"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      <pre
        aria-live="polite"
        className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-relaxed text-muted"
        onScroll={handleScroll}
        ref={consoleRef}
      >
        {output}
      </pre>
    </div>
  );
}
