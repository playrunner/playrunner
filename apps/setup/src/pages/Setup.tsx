import { useMemo, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Badge, Button, Input } from '@frontend/components/ui';
import type { RuntimeSetupConfig } from '../lib/setup';
import { getActiveSetupSessionToken } from '../lib/setup';

type SetupPhase = 'configure' | 'complete';

type SetupFormState = Omit<RuntimeSetupConfig, 'directUrl'> & {
  confirmPassword: string;
};

const DEFAULT_DATABASE_URL =
  import.meta.env.VITE_DEFAULT_DATABASE_URL?.trim() ||
  'postgresql://postgres:postgres@127.0.0.1:5432/playrunner?schema=public';

const EMPTY_SETUP_FORM: SetupFormState = {
  databaseUrl: DEFAULT_DATABASE_URL,
  username: 'admin',
  password: '',
  confirmPassword: '',
};

const SURFACE_CARD_CLASS =
  'rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm';
const INSET_CARD_CLASS =
  'rounded-xl border border-[var(--border)] bg-[var(--background)]';
const CODE_BLOCK_CLASS =
  'overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] p-3 font-mono text-xs text-[var(--foreground)]';
const SECTION_LABEL_CLASS =
  'text-xs font-semibold uppercase tracking-[0.24em] text-muted';

function isValidPostgresUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'postgres:' || url.protocol === 'postgresql:';
  } catch {
    return false;
  }
}

function normalizeSetupPayload(form: SetupFormState): RuntimeSetupConfig {
  return {
    databaseUrl: form.databaseUrl.trim(),
    username: form.username.trim(),
    password: form.password,
  };
}

export default function Setup() {
  const [phase, setPhase] = useState<SetupPhase>('configure');
  const [setupForm, setSetupForm] = useState<SetupFormState>(EMPTY_SETUP_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const missingFields = useMemo(() => {
    const fields: string[] = [];

    if (!setupForm.databaseUrl.trim()) {
      fields.push('Database URL');
    }

    if (!setupForm.username.trim()) {
      fields.push('Admin username');
    }

    if (!setupForm.password.trim()) {
      fields.push('Admin password');
    }

    return fields;
  }, [setupForm.databaseUrl, setupForm.password, setupForm.username]);

  const invalidFields = useMemo(() => {
    const fields: string[] = [];

    if (
      setupForm.databaseUrl.trim() &&
      !isValidPostgresUrl(setupForm.databaseUrl)
    ) {
      fields.push('Database URL');
    }

    return fields;
  }, [setupForm.databaseUrl]);

  const validateSetupForm = () => {
    if (missingFields.length > 0) {
      return `Missing required fields: ${missingFields.join(', ')}`;
    }

    if (invalidFields.length > 0) {
      return `${invalidFields.join(', ')} must use a postgres:// or postgresql:// URL.`;
    }

    if (setupForm.password.trim().length < 8) {
      return 'Admin password must be at least 8 characters.';
    }

    if (setupForm.password !== setupForm.confirmPassword) {
      return 'Password confirmation does not match.';
    }

    return null;
  };

  const handleSubmit = async () => {
    const formError = validateSetupForm();
    if (formError) {
      setValidationError(formError);
      return;
    }

    const setupSessionToken = getActiveSetupSessionToken();
    if (!setupSessionToken) {
      setValidationError(
        'Missing setup session token. Restart with an explicit setup launch.',
      );
      return;
    }

    setValidationError(null);
    setIsSubmitting(true);

    try {
      const response = await window.fetch(
        `/setup-api/setup/runtime/complete?token=${encodeURIComponent(setupSessionToken)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(normalizeSetupPayload(setupForm)),
        },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          payload?.error ?? 'Failed to save PostgreSQL and local admin setup.',
        );
      }

      setPhase('complete');
    } catch (error) {
      setValidationError(
        error instanceof Error
          ? error.message
          : 'Failed to save PostgreSQL and local admin setup.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-[var(--foreground)] font-sans">
      <div className="mx-auto max-w-3xl px-5 py-8 md:px-8 md:py-12">
        <header className="border-b border-subtle pb-6">
          <div className="space-y-4">
            <Badge variant="outline" className="w-fit gap-2 px-3 py-1">
              <img
                src="/images/playrunner-icon.svg"
                alt="Playrunner"
                className="h-4 w-4 object-contain"
              />
              Local setup
            </Badge>
            <div className="space-y-2">
              <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-[var(--foreground)]">
                Connect PostgreSQL and create the first admin login.
              </h1>
              <p className="max-w-3xl text-sm leading-relaxed text-muted">
                Enter a PostgreSQL URL, an admin username, and a password. To
                rerun setup later, delete{' '}
                <code className="font-mono text-xs text-[var(--foreground)]">
                  apps/api/.env
                </code>
                , then start{' '}
                <code className="font-mono text-xs text-[var(--foreground)]">
                  ./start-local.sh
                </code>{' '}
                again.
              </p>
            </div>
          </div>
        </header>

        <div className="mt-8">
          <section className={`${SURFACE_CARD_CLASS} w-full p-6 md:p-8`}>
            {phase === 'configure' ? (
              <div className="space-y-6">
                <div className="border-b border-subtle pb-5">
                  <p className={SECTION_LABEL_CLASS}>Setup form</p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--foreground)]">
                    Configure the local app
                  </h2>
                </div>

                <div className={`${INSET_CARD_CLASS} p-5`}>
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="block text-sm font-medium text-[var(--foreground)]">
                        Database URL
                      </label>
                      <p className="text-xs text-muted">
                        <code className="font-mono text-[11px] text-[var(--foreground)]">
                          DATABASE_URL
                        </code>
                      </p>
                      <Input
                        placeholder={DEFAULT_DATABASE_URL}
                        value={setupForm.databaseUrl}
                        onChange={(event) =>
                          setSetupForm((current) => ({
                            ...current,
                            databaseUrl: event.target.value,
                          }))
                        }
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-sm font-medium text-[var(--foreground)]">
                        Admin username
                      </label>
                      <Input
                        placeholder="admin"
                        value={setupForm.username}
                        onChange={(event) =>
                          setSetupForm((current) => ({
                            ...current,
                            username: event.target.value,
                          }))
                        }
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-sm font-medium text-[var(--foreground)]">
                        Admin password
                      </label>
                      <Input
                        type="password"
                        placeholder="Use at least 8 characters"
                        value={setupForm.password}
                        onChange={(event) =>
                          setSetupForm((current) => ({
                            ...current,
                            password: event.target.value,
                          }))
                        }
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-sm font-medium text-[var(--foreground)]">
                        Confirm password
                      </label>
                      <Input
                        type="password"
                        placeholder="Repeat the password"
                        value={setupForm.confirmPassword}
                        onChange={(event) =>
                          setSetupForm((current) => ({
                            ...current,
                            confirmPassword: event.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                </div>

                {validationError ? (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-500">
                    {validationError}
                  </div>
                ) : null}

                <div className="flex justify-end">
                  <Button
                    variant="primary"
                    onClick={handleSubmit}
                    className="gap-2"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? 'Saving setup...' : 'Save setup'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="border-b border-subtle pb-5">
                  <p className={SECTION_LABEL_CLASS}>Setup complete</p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--foreground)]">
                    Local setup is ready
                  </h2>
                </div>

                <div className={`${INSET_CARD_CLASS} p-5`}>
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-500" />
                    <div>
                      <p className="text-sm font-medium text-[var(--foreground)]">
                        Stop this setup session and start the normal app.
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-muted">
                        Sign in with{' '}
                        <code className="font-mono text-xs text-[var(--foreground)]">
                          {setupForm.username || 'admin'}
                        </code>{' '}
                        and the password you just created.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className={`${INSET_CARD_CLASS} p-4`}>
                    <p className="text-sm font-medium text-[var(--foreground)]">
                      Run next
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      Start the normal local development stack.
                    </p>
                    <pre className={`${CODE_BLOCK_CLASS} mt-3`}>
                      <code>./start-local.sh</code>
                    </pre>
                  </div>

                  <div className={`${INSET_CARD_CLASS} p-4`}>
                    <p className="text-sm font-medium text-[var(--foreground)]">
                      Reset setup
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      Delete the generated API env file and rerun setup if you
                      need to change these values later.
                    </p>
                    <pre className={`${CODE_BLOCK_CLASS} mt-3`}>
                      <code>{`rm apps/api/.env
./start-local.sh`}</code>
                    </pre>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
