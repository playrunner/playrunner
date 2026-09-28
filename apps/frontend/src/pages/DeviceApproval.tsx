import { useMemo, useState } from 'react';
import { CheckCircle2, Laptop, ShieldCheck } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { auth } from '../lib/auth';
import { Button } from '../components/ui/Button';

export default function DeviceApproval() {
  const [params] = useSearchParams();
  const code = useMemo(
    () => (params.get('code') || '').toUpperCase(),
    [params],
  );
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  const approve = async () => {
    setWorking(true);
    setError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/auth-companion/device-codes/approve', {
        body: JSON.stringify({ userCode: code }),
        headers: {
          Authorization: `Bearer ${token || ''}`,
          'content-type': 'application/json',
        },
        method: 'POST',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(payload.error || 'Device approval failed.');
      setApproved(true);
    } catch (approvalError) {
      setError(
        approvalError instanceof Error
          ? approvalError.message
          : 'Device approval failed.',
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-7xl space-y-8 p-8">
      <header className="border-b border-subtle pb-6">
        <h1 className="text-3xl font-semibold tracking-tight">Pair a device</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Approve the computer that requested access to Authentication Profiles.
        </p>
      </header>
      <section className="max-w-xl rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-hover)]">
            {approved ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : (
              <Laptop className="h-4 w-4" />
            )}
          </div>
          <div>
            <h2 className="text-xl font-medium">
              {approved ? 'Device paired' : 'Confirm pairing code'}
            </h2>
            <p className="mt-2 font-mono text-lg tracking-widest">
              {code || 'Missing code'}
            </p>
          </div>
        </div>
        <div className="mt-5 flex items-start gap-3 rounded-lg border border-subtle bg-[var(--surface-hover)] p-3 text-muted shadow-inner">
          <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="text-xs leading-relaxed">
            Approve only if this exact code is visible in a terminal you
            control. The device can only receive Authentication Profile capture
            requests.
          </p>
        </div>
        {error ? (
          <p className="mt-4 text-sm text-red-500" role="alert">
            {error}
          </p>
        ) : null}
        {!approved ? (
          <Button
            className="mt-5"
            disabled={!code || working}
            onClick={() => void approve()}
          >
            {working ? 'Approving…' : 'Approve device'}
          </Button>
        ) : (
          <p className="mt-5 text-sm text-muted">
            You can close this page and return to the terminal.
          </p>
        )}
      </section>
    </main>
  );
}
