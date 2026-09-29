import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Info } from 'lucide-react';
import { auth } from '../lib/auth';
import { Button, Select } from './ui';

type Renewal = {
  available?: boolean;
  enabled: boolean;
  intervalMinutes: number;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  result: string | null;
};
const messages: Record<string, string> = {
  queued: 'Session check queued…',
  checking: 'Checking the saved session…',
  valid: 'Session verified and refreshed.',
  needs_reauth:
    'The site is asking you to sign in again. Re-authenticate to resume renewal.',
  error: 'The check could not complete. Your saved session is unchanged.',
};

export function AuthenticationRenewal({
  profileId,
  onChecked,
}: {
  profileId: string;
  onChecked: () => void;
}) {
  const [renewal, setRenewal] = useState<Renewal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const checkedAt = useRef<string | null>(null);
  const onCheckedRef = useRef(onChecked);
  useEffect(() => {
    onCheckedRef.current = onChecked;
  }, [onChecked]);
  const request = useCallback(
    async (suffix = '', init: RequestInit = {}) => {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(
        `/api/authentication-profiles/${encodeURIComponent(profileId)}/renewal${suffix}`,
        {
          ...init,
          cache: 'no-store',
          headers: {
            Authorization: `Bearer ${token || ''}`,
            'content-type': 'application/json',
          },
        },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || 'Session renewal is unavailable.');
      return payload.renewal as Renewal;
    },
    [profileId],
  );
  useEffect(() => {
    let active = true;
    let timer: number;
    const load = async () => {
      try {
        const next = await request();
        if (!active) return;
        setRenewal(next);
        if (next.lastCheckedAt && next.lastCheckedAt !== checkedAt.current)
          onCheckedRef.current();
        checkedAt.current = next.lastCheckedAt;
        setError('');
        timer = window.setTimeout(
          () => {
            if (document.visibilityState === 'visible') void load();
            else timer = window.setTimeout(load, 30_000);
          },
          ['queued', 'checking'].includes(next.result || '') ? 3000 : 30_000,
        );
      } catch {
        if (active) {
          setError('Session renewal is unavailable.');
          timer = window.setTimeout(load, 30_000);
        }
      }
    };
    void load();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [request, refreshKey]);
  const update = async (interval?: string) => {
    setBusy(true);
    setError('');
    try {
      const next =
        interval === undefined
          ? await request('/check', { method: 'POST' })
          : await request('', {
              method: 'PUT',
              body: JSON.stringify({
                enabled: interval !== 'off',
                intervalMinutes:
                  interval === 'off'
                    ? renewal?.intervalMinutes || 60
                    : Number(interval),
              }),
            });
      setRenewal(next);
      setRefreshKey((value) => value + 1);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Session renewal could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-4 space-y-3 border-t border-subtle pt-4">
      <label
        htmlFor={`renewal-${profileId}`}
        className="block text-sm font-medium"
      >
        Keep session alive
      </label>
      <Select
        id={`renewal-${profileId}`}
        disabled={!renewal || renewal.available === false || busy}
        value={renewal?.enabled ? String(renewal.intervalMinutes) : 'off'}
        onChange={(event) => void update(event.target.value)}
      >
        <option value="off">Off</option>
        <option value="15">Every 15 minutes</option>
        <option value="30">Every 30 minutes</option>
        <option value="60">Every hour</option>
        <option value="120">Every 2 hours</option>
        <option value="360">Every 6 hours</option>
        <option value="1440">Every day</option>
      </Select>
      <div className="flex items-start gap-2 text-xs leading-relaxed text-muted">
        <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          {renewal?.available === false
            ? 'Session checks are not enabled on this server.'
            : 'This server checks the saved login and saves renewed cookies. Your computer can be off. Some sites will still require a new sign-in.'}
        </p>
      </div>
      <p className="text-xs text-muted" role="status">
        {messages[renewal?.result || ''] ||
          'Check the saved session before signing in again.'}
      </p>
      {renewal?.lastCheckedAt && (
        <p className="text-xs text-muted">
          Last checked: {new Date(renewal.lastCheckedAt).toLocaleString()}
        </p>
      )}
      {renewal?.enabled && renewal.nextCheckAt && (
        <p className="text-xs text-muted">
          Next check: {new Date(renewal.nextCheckAt).toLocaleString()}
        </p>
      )}
      {error && (
        <p className="text-xs text-red-500" role="alert">
          {error}
        </p>
      )}
      <Button
        className="gap-2"
        variant="secondary"
        size="sm"
        disabled={
          busy ||
          !renewal ||
          renewal.available === false ||
          ['queued', 'checking'].includes(renewal.result || '')
        }
        onClick={() => void update()}
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Check now
      </Button>
    </div>
  );
}
