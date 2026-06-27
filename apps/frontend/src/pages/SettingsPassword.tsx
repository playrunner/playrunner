import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, KeyRound, Loader2 } from 'lucide-react';
import { Button, Input } from '../components/ui';
import { DbAPI } from '../lib/db';

export default function SettingsPassword() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError(null);
    setPasswordStatus(null);

    if (!currentPassword || !newPassword) {
      setPasswordError('Current password and new password are required.');
      return;
    }

    if (newPassword.trim().length < 8) {
      setPasswordError('New password must be at least 8 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('Password confirmation does not match.');
      return;
    }

    setIsChangingPassword(true);
    try {
      await DbAPI.changePassword({
        currentPassword,
        newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordStatus('Password changed.');
    } catch (error) {
      setPasswordError(
        error instanceof Error ? error.message : 'Failed to change password.',
      );
    } finally {
      setIsChangingPassword(false);
    }
  };

  return (
    <main className="flex-1 p-8 max-w-7xl mx-auto w-full space-y-8">
      <div className="border-b border-subtle pb-6">
        <Link
          to="/settings"
          className="inline-flex items-center gap-2 text-sm font-medium text-muted transition-colors hover:text-[var(--foreground)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Settings
        </Link>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight text-[var(--foreground)]">
          Change Password
        </h2>
        <p className="mt-2 text-sm text-muted leading-relaxed">
          Update the password for this local Playrunner login.
        </p>
      </div>

      {passwordStatus ? (
        <section className="bg-surface border border-subtle rounded-xl overflow-hidden shadow-sm">
          <div className="p-6">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-500">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-xl font-medium text-[var(--foreground)] mb-1">
                  {passwordStatus}
                </h3>
                <p className="text-sm text-muted leading-relaxed">
                  Your local Playrunner login now uses the new password.
                </p>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <form
          className="bg-surface border border-subtle rounded-xl overflow-hidden shadow-sm"
          onSubmit={handlePasswordSubmit}
        >
          <div className="p-6 border-b border-subtle">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-subtle bg-surface-hover text-muted">
                <KeyRound className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-xl font-medium text-[var(--foreground)] mb-1">
                  Password
                </h3>
                <p className="text-sm text-muted leading-relaxed">
                  Enter your current password before setting a new one.
                </p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <label className="text-sm font-medium text-muted md:pt-2">
                Current password
              </label>
              <div className="md:col-span-3">
                <Input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  className="max-w-md"
                  autoComplete="current-password"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <label className="text-sm font-medium text-muted md:pt-2">
                New password
              </label>
              <div className="md:col-span-3">
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className="max-w-md"
                  autoComplete="new-password"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <label className="text-sm font-medium text-muted md:pt-2">
                Confirm password
              </label>
              <div className="md:col-span-3">
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="max-w-md"
                  autoComplete="new-password"
                />
              </div>
            </div>

            {passwordError ? (
              <p className="text-sm text-red-500">{passwordError}</p>
            ) : null}
          </div>

          <div className="p-6 border-t border-subtle bg-surface-hover/50 flex justify-end">
            <Button
              type="submit"
              variant="primary"
              disabled={isChangingPassword}
            >
              {isChangingPassword ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Change Password
            </Button>
          </div>
        </form>
      )}
    </main>
  );
}
