import React, { useState } from 'react';
import { Cloud, Loader2, TerminalSquare } from 'lucide-react';
import { auth } from '../lib/auth';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

interface TunnelDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onStarted: () => void;
  providerLabel?: string;
}

export function TunnelDialog({
  isOpen,
  onClose,
  onStarted,
  providerLabel = 'Cloud',
}: TunnelDialogProps) {
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStart = async () => {
    setIsStarting(true);
    setError(null);
    try {
      const token = auth.currentUser ? await auth.currentUser.getIdToken() : '';
      const response = await fetch('/api/tunnel/start', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        url?: string;
      } | null;
      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error || 'Failed to start the tunnel.');
      }
      onStarted();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to start the tunnel.',
      );
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={isStarting ? () => {} : onClose}
      zIndex={75}
      maxWidth="max-w-[520px]"
      title="Start a tunnel for cloud runners"
      icon={<Cloud className="w-4 h-4 text-[var(--foreground)]" />}
      footer={
        <>
          <Button
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={isStarting}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={handleStart} disabled={isStarting}>
            {isStarting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                Starting…
              </>
            ) : (
              'Start tunnel'
            )}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm text-[var(--foreground)]">
        <p className="text-muted leading-relaxed">
          You&apos;re running Playrunner locally but targeting the{' '}
          <span className="font-medium text-[var(--foreground)]">
            {providerLabel}
          </span>{' '}
          runner. Cloud runners need a public address to send logs and results
          back to your local API. A secure Cloudflare tunnel exposes it for the
          duration of your debugging session.
        </p>

        <div className="bg-[var(--control-bg)] border border-[var(--border)] rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-[var(--foreground)]">
            <TerminalSquare className="w-3.5 h-3.5 text-muted" />
            Before you continue: install cloudflared in your OS
          </div>
          <p className="text-[11px] leading-snug text-muted">
            The app can&apos;t install OS tools for you. Make sure{' '}
            <code className="px-1 py-0.5 rounded bg-surface-hover text-[var(--foreground)]">
              cloudflared
            </code>{' '}
            is installed and on your PATH, for example:
          </p>
          <pre className="text-[11px] bg-surface-hover text-[var(--foreground)] rounded px-2 py-1.5 overflow-x-auto">
            brew install cloudflared
          </pre>
          <p className="text-[11px] leading-snug text-muted">
            See{' '}
            <a
              href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-[var(--foreground)]"
            >
              Cloudflare&apos;s install guide
            </a>{' '}
            for other operating systems.
          </p>
        </div>

        {error ? (
          <div className="text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 leading-snug">
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
