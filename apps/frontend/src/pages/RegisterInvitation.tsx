import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, LockKeyhole, Mail, UserPlus } from 'lucide-react';
import { Button, Input } from '../components/ui';
import { registerWithInvitation } from '../lib/auth';

type InvitationPreview = {
  email: string;
  status: string;
  teamName: string;
};

export default function RegisterInvitation() {
  const [searchParams] = useSearchParams();
  const invitationToken = searchParams.get('invitation') ?? '';
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    void fetch(`/api/auth/invitations/${encodeURIComponent(invitationToken)}`)
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
          invitation?: InvitationPreview;
        } | null;
        if (!response.ok || !payload?.invitation) {
          throw new Error(payload?.error ?? 'Failed to load the invitation.');
        }
        setInvitation(payload.invitation);
      })
      .catch((loadError) =>
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Failed to load the invitation.',
        ),
      )
      .finally(() => setIsLoading(false));
  }, [invitationToken]);

  const register = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!invitation) return;
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await registerWithInvitation(invitationToken, invitation.email, password);
      navigate('/teams', { replace: true });
    } catch (registerError) {
      setError(
        registerError instanceof Error
          ? registerError.message
          : 'Registration failed.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const returnTo = `/teams/invitations/${encodeURIComponent(invitationToken)}`;

  return (
    <main className="min-h-screen bg-background px-4 py-12 text-[var(--foreground)]">
      <section className="mx-auto max-w-md bg-surface border border-subtle rounded-xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-subtle">
          <div className="h-9 w-9 rounded-lg bg-surface-hover border border-subtle flex items-center justify-center text-muted mb-4">
            <UserPlus className="h-4 w-4" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Create your account
          </h1>
          <p className="mt-2 text-sm text-muted leading-relaxed">
            Register with the invited email address to join the team.
          </p>
        </div>
        <div className="p-6">
          {isLoading ? (
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted" />
          ) : invitation ? (
            <form className="space-y-4" onSubmit={register}>
              <div className="rounded-xl border border-subtle bg-[var(--background)] p-4">
                <p className="text-sm font-medium">
                  Join {invitation.teamName}
                </p>
                <p className="mt-1 flex items-center gap-2 text-xs text-muted">
                  <Mail className="h-3.5 w-3.5" />
                  {invitation.email}
                </p>
              </div>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Password</span>
                <Input
                  type="password"
                  icon={<LockKeyhole className="h-4 w-4" />}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={8}
                  autoComplete="new-password"
                  required
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Confirm password</span>
                <Input
                  type="password"
                  icon={<LockKeyhole className="h-4 w-4" />}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  minLength={8}
                  autoComplete="new-password"
                  required
                />
              </label>
              {error ? (
                <p role="alert" className="text-sm text-red-500">
                  {error}
                </p>
              ) : null}
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting
                  ? 'Creating account...'
                  : 'Create account and join'}
              </Button>
              <p className="text-center text-xs text-muted">
                Already have an account?{' '}
                <Link
                  className="font-medium text-[var(--foreground)] underline underline-offset-4"
                  to={`/login?returnTo=${encodeURIComponent(returnTo)}`}
                >
                  Sign in
                </Link>
              </p>
            </form>
          ) : error ? (
            <p role="alert" className="text-sm text-red-500">
              {error}
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
