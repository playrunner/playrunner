import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  KeyRound,
  Loader2,
  MonitorUp,
  Plus,
  RotateCcw,
  ShieldAlert,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, ConfirmDialog, Input, Select } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { DbAPI } from '../lib/db';

type Environment = { id: string; name: string };
type ProfileStatus =
  | 'authenticated'
  | 'authenticating'
  | 'expired'
  | 'needs_reauth'
  | 'revoked'
  | 'unauthenticated';
type AuthenticationProfile = {
  applicationLabel: string | null;
  authenticatedAt: string | null;
  authenticationMethod: 'local_agent';
  credentialStatus: { configured: boolean };
  environmentId: string;
  expiresAt: string | null;
  id: string;
  name: string;
  roleLabel: string | null;
  startUrl: string;
  status: ProfileStatus;
  successCondition: {
    type: 'element_visible' | 'url_exact' | 'url_prefix';
    value: string;
  };
};
type AuthenticationSession = {
  error?: string;
  id: string;
  mode: 'authenticate' | 'test';
  profileId: string;
  status:
    | 'browser_launched'
    | 'cancelled'
    | 'capturing'
    | 'completed'
    | 'failed'
    | 'started'
    | 'timed_out';
};

const statusLabels: Record<ProfileStatus, string> = {
  authenticated: 'Authenticated',
  authenticating: 'Authenticating',
  expired: 'Expired',
  needs_reauth: 'Needs re-authentication',
  revoked: 'Revoked',
  unauthenticated: 'Not authenticated',
};

function dateLabel(value: string | null) {
  return value ? new Date(value).toLocaleString() : '—';
}

function statusVariant(status: ProfileStatus) {
  if (status === 'authenticated') return 'success' as const;
  if (status === 'expired' || status === 'revoked') return 'danger' as const;
  return 'outline' as const;
}

export default function AuthenticationProfiles() {
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<AuthenticationProfile[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [capabilityAvailable, setCapabilityAvailable] = useState(false);
  const [sessions, setSessions] = useState<
    Record<string, AuthenticationSession>
  >({});
  const [editing, setEditing] = useState<AuthenticationProfile | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    action: 'delete' | 'revoke';
    profile: AuthenticationProfile;
  } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [nextProfiles, nextEnvironments, capability] = await Promise.all([
        DbAPI.getAuthenticationProfiles(),
        DbAPI.getEnvironments(''),
        DbAPI.getAuthenticationCapability(),
      ]);
      setProfiles(nextProfiles);
      setEnvironments(nextEnvironments);
      setCapabilityAvailable(capability.available);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Authentication Profiles could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const active = Object.values(sessions).filter((session) =>
      ['started', 'browser_launched', 'capturing'].includes(session.status),
    );
    if (!active.length) return;
    const timer = window.setInterval(() => {
      void Promise.all(
        active.map(async (session) => {
          try {
            const next = await DbAPI.getAuthenticationProfileSession(
              session.id,
            );
            setSessions((current) => ({
              ...current,
              [next.profileId]: next,
            }));
            if (
              ['completed', 'failed', 'cancelled', 'timed_out'].includes(
                next.status,
              )
            ) {
              await load();
            }
          } catch (sessionError) {
            setError(
              sessionError instanceof Error
                ? sessionError.message
                : 'Authentication session could not be refreshed.',
            );
          }
        }),
      );
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [load, sessions]);

  const environmentNames = useMemo(
    () =>
      new Map(
        environments.map((environment) => [environment.id, environment.name]),
      ),
    [environments],
  );

  const startSession = async (
    profile: AuthenticationProfile,
    mode: 'authenticate' | 'test',
  ) => {
    setError('');
    try {
      const session = await DbAPI.startAuthenticationProfileSession(
        profile.id,
        mode,
      );
      setSessions((current) => ({ ...current, [profile.id]: session }));
      await load();
    } catch (sessionError) {
      setError(
        sessionError instanceof Error
          ? sessionError.message
          : 'Authentication session could not be started.',
      );
    }
  };

  const cancelSession = async (session: AuthenticationSession) => {
    try {
      const next = await DbAPI.cancelAuthenticationProfileSession(session.id);
      setSessions((current) => ({ ...current, [next.profileId]: next }));
      await load();
    } catch (cancelError) {
      setError(
        cancelError instanceof Error
          ? cancelError.message
          : 'Authentication session could not be cancelled.',
      );
    }
  };

  const completeSession = async (session: AuthenticationSession) => {
    setError('');
    try {
      const next = await DbAPI.completeAuthenticationProfileSession(session.id);
      setSessions((current) => ({ ...current, [next.profileId]: next }));
    } catch (completeError) {
      setError(
        completeError instanceof Error
          ? completeError.message
          : 'Authentication state could not be captured.',
      );
    }
  };

  const confirmDestructiveAction = async () => {
    if (!confirmAction) return;
    try {
      if (confirmAction.action === 'delete') {
        await DbAPI.deleteAuthenticationProfile(confirmAction.profile.id);
      } else {
        await DbAPI.revokeAuthenticationProfile(confirmAction.profile.id);
      }
      setConfirmAction(null);
      await load();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'Authentication Profile could not be changed.',
      );
    }
  };

  return (
    <main className="max-w-7xl mx-auto p-8 w-full space-y-8">
      <header className="flex flex-col gap-4 border-b border-subtle pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--foreground)]">
            Authentication Profiles
          </h1>
          <p className="mt-2 text-sm text-muted leading-relaxed">
            Reuse authenticated browser sessions without storing
            identity-provider passwords.
          </p>
        </div>
        <Button
          variant="primary"
          className="gap-2"
          disabled={!environments.length}
          onClick={() => {
            setEditing(null);
            setShowEditor(true);
          }}
        >
          <Plus className="h-4 w-4" /> Create profile
        </Button>
      </header>

      {!capabilityAvailable && !loading ? (
        <div className="flex items-start gap-3 rounded-lg border border-subtle bg-[var(--surface-hover)] p-3 text-muted shadow-inner">
          <ShieldAlert
            className="h-4 w-4 shrink-0 text-amber-500"
            aria-hidden="true"
          />
          <p className="text-xs leading-relaxed">
            Local interactive authentication is unavailable. Run the local
            Playrunner API on this machine and enable its interactive
            authentication capability.
          </p>
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-red-500"
        >
          <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="text-xs leading-relaxed">{error}</p>
        </div>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2
            className="h-6 w-6 animate-spin text-muted"
            aria-label="Loading Authentication Profiles"
          />
        </div>
      ) : !environments.length ? (
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center shadow-sm">
          <KeyRound className="mx-auto h-8 w-8 text-muted" aria-hidden="true" />
          <h2 className="mt-4 text-xl font-medium">
            Create an Environment first
          </h2>
          <p className="mt-2 text-sm text-muted">
            Every Authentication Profile is isolated to an Environment.
          </p>
          <Button
            variant="secondary"
            className="mt-5"
            onClick={() => navigate('/environments')}
          >
            Open Environments
          </Button>
        </section>
      ) : profiles.length === 0 ? (
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center shadow-sm">
          <MonitorUp
            className="mx-auto h-8 w-8 text-muted"
            aria-hidden="true"
          />
          <h2 className="mt-4 text-xl font-medium">
            No Authentication Profiles yet
          </h2>
          <p className="mt-2 text-sm text-muted">
            Create one, then authenticate manually in the visible browser.
          </p>
        </section>
      ) : (
        <section className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {profiles.map((profile) => {
            const session = sessions[profile.id];
            const active =
              session &&
              ['started', 'browser_launched', 'capturing'].includes(
                session.status,
              );
            return (
              <article
                key={profile.id}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-medium text-[var(--foreground)]">
                      {profile.name}
                    </h2>
                    <p className="mt-1 text-sm text-muted">
                      {profile.applicationLabel || profile.startUrl}
                    </p>
                  </div>
                  <Badge variant={statusVariant(profile.status)}>
                    {statusLabels[profile.status]}
                  </Badge>
                </div>
                <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
                  <dt className="text-muted">Environment</dt>
                  <dd className="text-right text-[var(--foreground)]">
                    {environmentNames.get(profile.environmentId) ||
                      'Unavailable'}
                  </dd>
                  <dt className="text-muted">Role</dt>
                  <dd className="text-right text-[var(--foreground)]">
                    {profile.roleLabel || '—'}
                  </dd>
                  <dt className="text-muted">Last authenticated</dt>
                  <dd className="text-right text-[var(--foreground)]">
                    {dateLabel(profile.authenticatedAt)}
                  </dd>
                  <dt className="text-muted">Known expiry</dt>
                  <dd className="text-right text-[var(--foreground)]">
                    {dateLabel(profile.expiresAt)}
                  </dd>
                </dl>

                {session ? (
                  <div className="mt-4 flex items-start gap-3 rounded-lg border border-subtle bg-[var(--surface-hover)] p-3">
                    {active ? (
                      <Loader2
                        className="h-4 w-4 shrink-0 animate-spin text-muted"
                        aria-hidden="true"
                      />
                    ) : session.status === 'completed' ? (
                      <CheckCircle2
                        className="h-4 w-4 shrink-0 text-emerald-500"
                        aria-hidden="true"
                      />
                    ) : (
                      <Clock3
                        className="h-4 w-4 shrink-0 text-amber-500"
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0 text-xs leading-relaxed text-muted">
                      <p>
                        {session.status === 'capturing'
                          ? 'Verifying and securely capturing the authenticated session…'
                          : active
                            ? session.mode === 'authenticate'
                              ? 'Complete sign-in in native Chrome. Leave it open, then return here.'
                              : 'Testing the stored session in a visible browser.'
                            : session.error ||
                              (session.mode === 'test'
                                ? 'Session test completed.'
                                : 'Authentication completed.')}
                      </p>
                      {active ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {session.mode === 'authenticate' &&
                          session.status === 'browser_launched' ? (
                            <Button
                              size="sm"
                              onClick={() => void completeSession(session)}
                            >
                              I’ve finished signing in
                            </Button>
                          ) : null}
                          <Button
                            variant="tertiary"
                            size="sm"
                            onClick={() => void cancelSession(session)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div className="mt-5 flex flex-wrap gap-2 border-t border-subtle pt-4">
                  <Button
                    size="sm"
                    disabled={!capabilityAvailable || Boolean(active)}
                    onClick={() => void startSession(profile, 'authenticate')}
                  >
                    {profile.credentialStatus.configured
                      ? 'Re-authenticate'
                      : 'Authenticate'}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={
                      !profile.credentialStatus.configured || Boolean(active)
                    }
                    onClick={() => void startSession(profile, 'test')}
                  >
                    Test session
                  </Button>
                  <Button
                    variant="tertiary"
                    size="sm"
                    disabled={Boolean(active)}
                    onClick={() => {
                      setEditing(profile);
                      setShowEditor(true);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="tertiary"
                    size="sm"
                    disabled={
                      !profile.credentialStatus.configured || Boolean(active)
                    }
                    onClick={() =>
                      setConfirmAction({ action: 'revoke', profile })
                    }
                  >
                    Revoke
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto text-red-500"
                    disabled={Boolean(active)}
                    aria-label={`Delete ${profile.name}`}
                    title={`Delete ${profile.name}`}
                    onClick={() =>
                      setConfirmAction({ action: 'delete', profile })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </article>
            );
          })}
        </section>
      )}

      <ProfileEditor
        environments={environments}
        isOpen={showEditor}
        profile={editing}
        onClose={() => setShowEditor(false)}
        onSaved={async () => {
          setShowEditor(false);
          await load();
        }}
      />

      <ConfirmDialog
        isOpen={Boolean(confirmAction)}
        title={`${confirmAction?.action === 'delete' ? 'Delete' : 'Revoke'} “${confirmAction?.profile.name || ''}”?`}
        description={
          confirmAction?.action === 'delete'
            ? 'This permanently deletes the profile and its encrypted browser state.'
            : 'This immediately removes the stored browser state. Re-authentication will be required before another execution.'
        }
        confirmLabel={
          confirmAction?.action === 'delete'
            ? 'Delete profile'
            : 'Revoke session'
        }
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => void confirmDestructiveAction()}
      />
    </main>
  );
}

function ProfileEditor({
  environments,
  isOpen,
  onClose,
  onSaved,
  profile,
}: {
  environments: Environment[];
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  profile: AuthenticationProfile | null;
}) {
  const [form, setForm] = useState({
    applicationLabel: '',
    environmentId: '',
    name: '',
    roleLabel: '',
    startUrl: '',
    successConditionType: 'url_prefix',
    successConditionValue: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setForm({
      applicationLabel: profile?.applicationLabel || '',
      environmentId: profile?.environmentId || environments[0]?.id || '',
      name: profile?.name || '',
      roleLabel: profile?.roleLabel || '',
      startUrl: profile?.startUrl || '',
      successConditionType: profile?.successCondition.type || 'url_prefix',
      successConditionValue: profile?.successCondition.value || '',
    });
  }, [environments, isOpen, profile]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = {
        applicationLabel: form.applicationLabel,
        environmentId: form.environmentId,
        name: form.name,
        roleLabel: form.roleLabel,
        startUrl: form.startUrl,
        successCondition: {
          type: form.successConditionType,
          value: form.successConditionValue,
        },
      };
      if (profile) {
        await DbAPI.updateAuthenticationProfile(profile.id, payload);
      } else {
        await DbAPI.createAuthenticationProfile(payload);
      }
      await onSaved();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Profile could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        profile
          ? 'Edit Authentication Profile'
          : 'Create Authentication Profile'
      }
      subtitle="Browser state is captured only after you authenticate manually."
      icon={<KeyRound className="h-4 w-4" />}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              saving ||
              !form.name.trim() ||
              !form.environmentId ||
              !form.startUrl.trim() ||
              !form.successConditionValue.trim()
            }
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save profile'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? (
          <p role="alert" className="text-sm text-red-500">
            {error}
          </p>
        ) : null}
        <Field label="Name">
          <Input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Staging Clinic Admin"
          />
        </Field>
        <Field label="Environment">
          <Select
            value={form.environmentId}
            onChange={(event) =>
              setForm({ ...form, environmentId: event.target.value })
            }
          >
            {environments.map((environment) => (
              <option key={environment.id} value={environment.id}>
                {environment.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Application label (optional)">
            <Input
              value={form.applicationLabel}
              onChange={(event) =>
                setForm({ ...form, applicationLabel: event.target.value })
              }
              placeholder="Patient portal"
            />
          </Field>
          <Field label="Role / test account (optional)">
            <Input
              value={form.roleLabel}
              onChange={(event) =>
                setForm({ ...form, roleLabel: event.target.value })
              }
              placeholder="Clinic Admin"
            />
          </Field>
        </div>
        <Field label="Start URL">
          <Input
            type="url"
            value={form.startUrl}
            onChange={(event) =>
              setForm({ ...form, startUrl: event.target.value })
            }
            placeholder="https://staging.example.com/login"
          />
        </Field>
        <Field label="Authentication success condition">
          <Select
            value={form.successConditionType}
            onChange={(event) =>
              setForm({ ...form, successConditionType: event.target.value })
            }
          >
            <option value="url_prefix">URL prefix</option>
            <option value="url_exact">Exact URL</option>
            <option value="element_visible">Element visible</option>
          </Select>
        </Field>
        <Field
          label={
            form.successConditionType === 'element_visible'
              ? 'Selector'
              : 'Success URL'
          }
        >
          <Input
            value={form.successConditionValue}
            onChange={(event) =>
              setForm({ ...form, successConditionValue: event.target.value })
            }
            placeholder={
              form.successConditionType === 'element_visible'
                ? '[data-testid="account-menu"]'
                : 'https://staging.example.com/app'
            }
          />
        </Field>
        <div className="flex items-start gap-3 rounded-lg border border-subtle bg-[var(--surface-hover)] p-3 text-muted shadow-inner">
          <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="text-xs leading-relaxed">
            Changing the Environment, start URL, or success condition marks an
            authenticated profile for re-authentication.
          </p>
        </div>
      </div>
    </Modal>
  );
}

function Field({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-[var(--foreground)]">
        {label}
      </span>
      {children}
    </label>
  );
}
