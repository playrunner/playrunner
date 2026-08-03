import { useEffect, useState } from 'react';
import { KeyRound, Mail, Plus, ShieldCheck, Trash2, User } from 'lucide-react';
import { Link } from 'react-router-dom';
import { IntegrationCopyableCode } from '@playrunner/integration-sdk';
import { Badge, Button, Input } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { auth } from '../lib/auth';
import { DbAPI } from '../lib/db';

type ApiToken = {
  allowedWorkflowIds: string[];
  createdAt: string;
  displayPrefix: string;
  expiresAt: string | null;
  id: string;
  lastUsedAt: string | null;
  name: string;
  revokedAt: string | null;
  scopes: string[];
};

type Workflow = { id: string; title?: string | null };

function getDisplayName(user: typeof auth.currentUser) {
  return (
    user?.name?.trim() || user?.email?.split('@')[0] || user?.username || ''
  );
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : 'Never';
}

export default function Settings() {
  const [currentUser, setCurrentUser] = useState(auth.currentUser);
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
  const [name, setName] = useState('CI');
  const [expiresAt, setExpiresAt] = useState('');
  const [allowedWorkflowIds, setAllowedWorkflowIds] = useState<string[]>([]);
  const [createdPlaintext, setCreatedPlaintext] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => auth.onAuthStateChanged(setCurrentUser), []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([DbAPI.getApiTokens(), DbAPI.getWorkflows('')])
      .then(([nextTokens, nextWorkflows]) => {
        if (!cancelled) {
          setTokens(nextTokens);
          setWorkflows(nextWorkflows);
        }
      })
      .catch((loadError) => {
        if (!cancelled) setError((loadError as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const email = currentUser?.email ?? '';
  const username = currentUser?.username ?? '';
  const displayName = getDisplayName(currentUser);

  const openTokenModal = () => {
    setName('CI');
    setExpiresAt('');
    setAllowedWorkflowIds([]);
    setCreatedPlaintext('');
    setError('');
    setIsTokenModalOpen(true);
  };

  const createToken = async () => {
    setIsSaving(true);
    setError('');
    try {
      const created = await DbAPI.createApiToken({
        allowedWorkflowIds,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        name: name.trim(),
      });
      setTokens((current) => [created.token, ...current]);
      setCreatedPlaintext(created.plaintext);
    } catch (createError) {
      setError((createError as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const revokeToken = async (token: ApiToken) => {
    if (!window.confirm(`Revoke the API token “${token.name}”?`)) return;
    try {
      await DbAPI.revokeApiToken(token.id);
      const revokedAt = new Date().toISOString();
      setTokens((current) =>
        current.map((item) =>
          item.id === token.id ? { ...item, revokedAt } : item,
        ),
      );
    } catch (revokeError) {
      setError((revokeError as Error).message);
    }
  };

  const rotateToken = async (token: ApiToken) => {
    if (!window.confirm(`Rotate the API token “${token.name}”?`)) return;
    setError('');
    try {
      const rotated = await DbAPI.rotateApiToken(token.id);
      const revokedAt = new Date().toISOString();
      setTokens((current) => [
        rotated.token,
        ...current.map((item) =>
          item.id === token.id ? { ...item, revokedAt } : item,
        ),
      ]);
      setCreatedPlaintext(rotated.plaintext);
      setIsTokenModalOpen(true);
    } catch (rotateError) {
      setError((rotateError as Error).message);
    }
  };

  return (
    <main className="flex-1 p-8 max-w-7xl mx-auto w-full space-y-8">
      {error && !isTokenModalOpen ? (
        <p className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-500">
          {error}
        </p>
      ) : null}
      <section className="bg-surface border border-subtle rounded-xl overflow-hidden shadow-sm">
        <div className="p-6 border-b border-subtle">
          <h2 className="text-xl font-medium text-[var(--foreground)] mb-1">
            Profile
          </h2>
          <p className="text-sm text-muted leading-relaxed">
            Account details from the local setup stored in Postgres.
          </p>
        </div>
        <div className="p-6 space-y-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="flex items-center gap-2 text-sm font-medium text-muted md:pt-2">
              <User className="h-4 w-4" /> Name
            </div>
            <div className="md:col-span-3">
              <p className="text-sm font-medium text-[var(--foreground)]">
                {displayName || 'Not configured'}
              </p>
              <p className="mt-1 text-xs text-muted">
                Derived from the local setup login.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="flex items-center gap-2 text-sm font-medium text-muted md:pt-2">
              <Mail className="h-4 w-4" /> Email address
            </div>
            <div className="md:col-span-3">
              <p className="text-sm font-medium text-[var(--foreground)]">
                {email || 'Not configured'}
              </p>
              <p className="mt-1 text-xs text-muted">
                {email
                  ? 'Read from the admin login configured during setup.'
                  : username
                    ? `The setup login is "${username}", which is not an email address.`
                    : 'No setup login is available for this session.'}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-surface border border-subtle rounded-xl overflow-hidden shadow-sm">
        <div className="p-6 border-b border-subtle flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-subtle bg-surface-hover text-muted">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-xl font-medium text-[var(--foreground)] mb-1">
                API tokens
              </h2>
              <p className="text-sm text-muted leading-relaxed">
                Run saved workflows from CI/CD without using a human login.
              </p>
            </div>
          </div>
          <Button variant="primary" className="gap-2" onClick={openTokenModal}>
            <Plus className="h-4 w-4" /> Create token
          </Button>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {tokens.length === 0 ? (
            <p className="p-6 text-sm text-muted">No API tokens created.</p>
          ) : (
            tokens.map((token) => (
              <div
                key={token.id}
                className="p-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-[var(--foreground)]">
                      {token.name}
                    </p>
                    <Badge variant={token.revokedAt ? 'outline' : 'success'}>
                      {token.revokedAt ? 'Revoked' : 'Active'}
                    </Badge>
                  </div>
                  <p className="mt-1 font-mono text-xs text-muted">
                    {token.displayPrefix}… · Last used{' '}
                    {formatDate(token.lastUsedAt)}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {token.allowedWorkflowIds.length
                      ? `${token.allowedWorkflowIds.length} selected workflow(s)`
                      : 'All workflows'}{' '}
                    · Expires {formatDate(token.expiresAt)}
                  </p>
                </div>
                {!token.revokedAt ? (
                  <div className="flex items-center gap-2 self-start md:self-auto">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void rotateToken(token)}
                    >
                      Rotate
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      className="gap-2"
                      onClick={() => void revokeToken(token)}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Revoke
                    </Button>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="bg-surface border border-subtle rounded-xl overflow-hidden shadow-sm">
        <div className="p-6 border-b border-subtle">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-subtle bg-surface-hover text-muted">
              <KeyRound className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-xl font-medium text-[var(--foreground)] mb-1">
                Password
              </h2>
              <p className="text-sm text-muted leading-relaxed">
                Change the password for this local Playrunner login.
              </p>
            </div>
          </div>
        </div>
        <div className="p-6 flex justify-end">
          <Link
            to="/settings/password"
            className="inline-flex h-9 items-center justify-center rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--foreground)] shadow-sm outline-none transition-colors hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--border-strong)]"
          >
            Change Password
          </Link>
        </div>
      </section>

      <Modal
        isOpen={isTokenModalOpen}
        onClose={() => setIsTokenModalOpen(false)}
        title="Create API token"
        subtitle="The plaintext token is shown once. Store it in your CI secret manager."
        icon={<ShieldCheck className="h-4 w-4" />}
        footer={
          createdPlaintext ? (
            <Button onClick={() => setIsTokenModalOpen(false)}>Done</Button>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={() => setIsTokenModalOpen(false)}
              >
                Cancel
              </Button>
              <Button disabled={!name.trim() || isSaving} onClick={createToken}>
                {isSaving ? 'Creating…' : 'Create token'}
              </Button>
            </>
          )
        }
      >
        {createdPlaintext ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
              <p className="text-sm font-medium text-[var(--foreground)]">
                Copy your token now
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Playrunner stores only its hash and cannot show this value
                again.
              </p>
              <IntegrationCopyableCode
                value={createdPlaintext}
                label="Copy API token"
              />
            </div>
            <p className="font-mono text-xs text-muted">
              PLAYRUNNER_API_KEY=&lt;token&gt; npx playrunner
              &lt;workflow-id&gt;
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">Token name</label>
              <Input
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">
                Expiry (optional)
              </label>
              <Input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Allowed workflows</p>
              <p className="text-xs text-muted">
                Select none to allow all workflows owned by this account.
              </p>
              <div className="max-h-48 space-y-2 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-3">
                {workflows.map((workflow) => (
                  <label
                    key={workflow.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={allowedWorkflowIds.includes(workflow.id)}
                      onChange={(event) =>
                        setAllowedWorkflowIds((current) =>
                          event.target.checked
                            ? [...current, workflow.id]
                            : current.filter((id) => id !== workflow.id),
                        )
                      }
                    />
                    <span>{workflow.title || 'Untitled Workflow'}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
        {error ? <p className="mt-4 text-sm text-red-500">{error}</p> : null}
      </Modal>
    </main>
  );
}
