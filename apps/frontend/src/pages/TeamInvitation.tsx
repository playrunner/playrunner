import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Loader2, Mail, Users } from 'lucide-react';
import { Badge, Button } from '../components/ui';
import { DbAPI } from '../lib/db';

type InvitationPreview = {
  email: string;
  expiresAt: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  teamName: string;
};

export default function TeamInvitation() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAccepting, setIsAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/api/auth/invitations/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
          invitation?: InvitationPreview;
        } | null;
        if (!response.ok || !payload?.invitation) {
          throw new Error(payload?.error ?? 'Failed to load the invitation.');
        }
        if (active) setInvitation(payload.invitation);
      })
      .catch((loadError) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Failed to load the invitation.',
          );
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const accept = async () => {
    setIsAccepting(true);
    setError(null);
    try {
      await DbAPI.acceptTeamInvitation(token);
      setAccepted(true);
    } catch (acceptError) {
      setError(
        acceptError instanceof Error
          ? acceptError.message
          : 'Failed to accept the invitation.',
      );
    } finally {
      setIsAccepting(false);
    }
  };

  return (
    <main className="flex-1 max-w-7xl mx-auto p-8 w-full">
      <section className="mx-auto max-w-xl bg-surface border border-subtle rounded-xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-subtle">
          <div className="h-9 w-9 rounded-lg bg-surface-hover border border-subtle flex items-center justify-center text-muted mb-4">
            <Users className="h-4 w-4" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--foreground)]">
            Team invitation
          </h1>
          <p className="text-sm text-muted leading-relaxed mt-2">
            Review the invitation before joining the shared workspace.
          </p>
        </div>

        <div className="p-6">
          {isLoading ? (
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted" />
          ) : error ? (
            <div
              role="alert"
              className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-500"
            >
              {error}
            </div>
          ) : accepted ? (
            <div className="text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
              <h2 className="mt-4 text-xl font-medium text-[var(--foreground)]">
                Invitation accepted
              </h2>
              <p className="mt-2 text-sm text-muted">
                You are now a member of {invitation?.teamName}.
              </p>
              <Button className="mt-5" onClick={() => navigate('/teams')}>
                View team
              </Button>
            </div>
          ) : invitation ? (
            <div className="space-y-5">
              <div className="rounded-xl border border-subtle bg-[var(--background)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-medium text-[var(--foreground)]">
                      {invitation.teamName}
                    </h2>
                    <p className="mt-2 flex items-center gap-2 text-sm text-muted">
                      <Mail className="h-4 w-4" />
                      {invitation.email}
                    </p>
                  </div>
                  <Badge
                    variant={
                      invitation.status === 'pending' ? 'default' : 'outline'
                    }
                  >
                    {invitation.status}
                  </Badge>
                </div>
              </div>
              {invitation.status === 'pending' ? (
                <Button
                  className="w-full"
                  disabled={isAccepting}
                  onClick={() => void accept()}
                >
                  {isAccepting ? 'Accepting...' : 'Accept invitation'}
                </Button>
              ) : (
                <p className="text-sm text-muted">
                  This invitation can no longer be accepted.
                </p>
              )}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
