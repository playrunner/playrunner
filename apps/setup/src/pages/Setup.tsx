import {useMemo, useState} from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Database,
  FolderKanban,
  LockKeyhole,
  Sparkles,
} from 'lucide-react';
import {Button, Input} from '@web/components/ui';
import {cn} from '@web/lib/utils';
import type {RuntimeSetupConfig} from '../lib/setup';
import {getActiveSetupSessionToken} from '../lib/setup';

type SetupStep = 'postgres' | 'prisma' | 'complete';

type SetupFormState = RuntimeSetupConfig & {
  confirmPassword: string;
};

const EMPTY_SETUP_FORM: SetupFormState = {
  databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:5432/playrunner?schema=public',
  directUrl: '',
  shadowDatabaseUrl: '',
  username: 'admin',
  password: '',
  confirmPassword: '',
};

const SETUP_PRIMARY_BUTTON_CLASS =
  'border border-white/20 bg-white text-slate-950 shadow-sm hover:bg-slate-200';
const SETUP_GHOST_BUTTON_CLASS =
  'rounded-lg border-transparent bg-transparent text-white shadow-none hover:bg-white/10 hover:text-white';

function getStepTitle(step: SetupStep) {
  switch (step) {
    case 'postgres':
      return 'Configure PostgreSQL';
    case 'prisma':
      return 'Review Prisma scaffold';
    case 'complete':
      return 'Finish local bootstrap';
    default:
      return 'Setup';
  }
}

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
    directUrl: form.directUrl?.trim() || undefined,
    shadowDatabaseUrl: form.shadowDatabaseUrl?.trim() || undefined,
    username: form.username.trim(),
    password: form.password,
  };
}

export default function Setup() {
  const [step, setStep] = useState<SetupStep>('postgres');
  const [setupForm, setSetupForm] = useState<SetupFormState>(EMPTY_SETUP_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const missingFields = useMemo(() => {
    const fields: string[] = [];
    if (!setupForm.databaseUrl.trim()) {
      fields.push('DATABASE_URL');
    }
    if (!setupForm.username.trim()) {
      fields.push('LOCAL_AUTH_USERNAME');
    }
    if (!setupForm.password.trim()) {
      fields.push('LOCAL_AUTH_PASSWORD');
    }
    return fields;
  }, [setupForm.databaseUrl, setupForm.password, setupForm.username]);

  const invalidFields = useMemo(() => {
    const fields: string[] = [];

    if (setupForm.databaseUrl.trim() && !isValidPostgresUrl(setupForm.databaseUrl)) {
      fields.push('DATABASE_URL');
    }
    if (setupForm.directUrl?.trim() && !isValidPostgresUrl(setupForm.directUrl)) {
      fields.push('DIRECT_URL');
    }
    if (
      setupForm.shadowDatabaseUrl?.trim() &&
      !isValidPostgresUrl(setupForm.shadowDatabaseUrl)
    ) {
      fields.push('SHADOW_DATABASE_URL');
    }

    return fields;
  }, [setupForm.databaseUrl, setupForm.directUrl, setupForm.shadowDatabaseUrl]);

  const handleBack = () => {
    setValidationError(null);

    if (step === 'complete') {
      setStep('prisma');
      return;
    }

    if (step === 'prisma') {
      setStep('postgres');
    }
  };

  const validatePostgresForm = () => {
    if (missingFields.length > 0) {
      return `Missing required fields: ${missingFields.join(', ')}`;
    }

    if (invalidFields.length > 0) {
      return `${invalidFields.join(', ')} must use a postgres:// or postgresql:// URL.`;
    }

    if (setupForm.password.trim().length < 8) {
      return 'LOCAL_AUTH_PASSWORD must be at least 8 characters.';
    }

    if (setupForm.password !== setupForm.confirmPassword) {
      return 'Password confirmation does not match.';
    }

    return null;
  };

  const submitSetupStep = async (mode: 'generate' | 'complete') => {
    const formError = validatePostgresForm();
    if (formError) {
      setValidationError(formError);
      return false;
    }

    const setupSessionToken = getActiveSetupSessionToken();
    if (!setupSessionToken) {
      setValidationError('Missing setup session token. Restart with an explicit setup launch.');
      return false;
    }

    setValidationError(null);
    setIsSubmitting(true);

    try {
      const response = await window.fetch(
        `/setup-api/setup/runtime/${mode}?token=${encodeURIComponent(setupSessionToken)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(normalizeSetupPayload(setupForm)),
        },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {error?: string} | null;
        throw new Error(
          payload?.error ??
            (mode === 'generate'
              ? 'Failed to write PostgreSQL and local auth setup files.'
              : 'Failed to finish PostgreSQL and local auth setup.'),
        );
      }

      return true;
    } catch (error) {
      setValidationError(
        error instanceof Error
          ? error.message
          : mode === 'generate'
            ? 'Failed to write PostgreSQL and local auth setup files.'
            : 'Failed to finish PostgreSQL and local auth setup.',
      );
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePostgresContinue = async () => {
    const succeeded = await submitSetupStep('generate');
    if (succeeded) {
      setStep('prisma');
    }
  };

  const handlePrismaContinue = () => {
    setValidationError(null);
    setStep('complete');
  };

  const handleSetupComplete = async () => {
    const succeeded = await submitSetupStep('complete');
    if (succeeded) {
      window.location.assign('/setup');
    }
  };

  return (
    <div className="min-h-screen overflow-hidden bg-background text-[var(--foreground)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(34,197,94,0.14),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(59,130,246,0.12),_transparent_35%)]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col justify-center px-6 py-10 lg:flex-row lg:items-stretch lg:gap-10">
        <section className="mb-8 flex-1 rounded-[2rem] border border-[var(--border)] bg-[linear-gradient(160deg,rgba(17,24,39,0.96),rgba(10,20,35,0.92))] p-8 text-white shadow-2xl lg:mb-0 lg:p-10">
          <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/6 px-4 py-2 text-sm">
            <img src="/images/playrunner-icon.svg" alt="Playrail" className="h-5 w-5" />
            <span>Playrail first-run setup</span>
          </div>

          <h1 className="mt-8 max-w-xl text-4xl font-semibold tracking-tight">
            Point the workspace at PostgreSQL and seed the first local login.
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-slate-300">
            This install is in an explicit one-time setup session. The wizard now writes
            PostgreSQL connection strings, a local username/password login, and Prisma scaffold
            files into <code>apps/api</code>.
          </p>
          <div className="mt-6 max-w-xl rounded-2xl border border-white/10 bg-white/6 p-4">
            <p className="text-sm font-medium">What this installer changes</p>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              If <code>apps/api/.env</code> is missing, setup will create it from{' '}
              <code>apps/api/.env.example</code> first. Then it will upsert PostgreSQL connection
              strings, local auth credentials, and the base Prisma schema files.
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
              <Database className="h-5 w-5 text-emerald-300" />
              <p className="mt-3 text-sm font-medium">PostgreSQL connection</p>
              <p className="mt-1 text-xs text-slate-300">
                Capture the Prisma datasource URL and any direct or shadow database overrides.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
              <LockKeyhole className="h-5 w-5 text-cyan-300" />
              <p className="mt-3 text-sm font-medium">Local login seed</p>
              <p className="mt-1 text-xs text-slate-300">
                Hash the first username/password pair and store the runtime auth settings in{' '}
                <code>apps/api/.env</code>.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
              <FolderKanban className="h-5 w-5 text-emerald-300" />
              <p className="mt-3 text-sm font-medium">Automatic bootstrap</p>
              <p className="mt-1 text-xs text-slate-300">
                The normal local start now brings up Postgres and runs Prisma bootstrap before the
                API comes online.
              </p>
            </div>
          </div>
        </section>

        <section className="w-full max-w-2xl rounded-[2rem] border border-[var(--border)] bg-[var(--surface)]/95 p-6 shadow-2xl backdrop-blur lg:p-8">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                Setup wizard
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                {getStepTitle(step)}
              </h2>
            </div>
            {step !== 'postgres' && (
              <Button
                variant="ghost"
                onClick={handleBack}
                className={cn('gap-2', SETUP_GHOST_BUTTON_CLASS)}
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            )}
          </div>

          {step === 'postgres' ? (
            <div className="space-y-6">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
                <div className="flex items-start gap-3">
                  <Database className="mt-0.5 h-5 w-5 text-sky-500" />
                  <div>
                    <p className="text-sm font-medium">
                      Paste the Prisma connection strings that should land in{' '}
                      <code>apps/api/.env</code>, then choose the first local login.
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      <code>DATABASE_URL</code> is required. Use <code>DIRECT_URL</code> when your
                      runtime connection differs from the migration connection, and{' '}
                      <code>SHADOW_DATABASE_URL</code> when you keep a dedicated shadow database for
                      Prisma Migrate. The username/password below become the credentials for the
                      local app login screen.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium">DATABASE_URL</label>
                  <Input
                    placeholder="postgresql://postgres:postgres@localhost:5432/playrunner?schema=public"
                    value={setupForm.databaseUrl}
                    onChange={(event) =>
                      setSetupForm((current) => ({
                        ...current,
                        databaseUrl: event.target.value,
                      }))
                    }
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium">
                    DIRECT_URL <span className="text-muted">(optional)</span>
                  </label>
                  <Input
                    placeholder="postgresql://postgres:postgres@localhost:5432/playrunner?schema=public"
                    value={setupForm.directUrl}
                    onChange={(event) =>
                      setSetupForm((current) => ({
                        ...current,
                        directUrl: event.target.value,
                      }))
                    }
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium">
                    SHADOW_DATABASE_URL <span className="text-muted">(optional)</span>
                  </label>
                  <Input
                    placeholder="postgresql://postgres:postgres@localhost:5432/playrunner_shadow?schema=public"
                    value={setupForm.shadowDatabaseUrl}
                    onChange={(event) =>
                      setSetupForm((current) => ({
                        ...current,
                        shadowDatabaseUrl: event.target.value,
                      }))
                    }
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-medium">LOCAL_AUTH_USERNAME</label>
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
                  <div>
                    <label className="mb-2 block text-sm font-medium">LOCAL_AUTH_PASSWORD</label>
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
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium">Confirm password</label>
                  <Input
                    type="password"
                    placeholder="Repeat the local login password"
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

              {validationError && <p className="text-sm text-red-500">{validationError}</p>}

              <div className="flex justify-end">
                <Button
                  onClick={handlePostgresContinue}
                  className={cn('gap-2', SETUP_PRIMARY_BUTTON_CLASS)}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Writing setup files...' : 'Write runtime scaffold'}
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : step === 'prisma' ? (
            <div className="space-y-6">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
                <div className="flex items-start gap-3">
                  <Sparkles className="mt-0.5 h-5 w-5 text-amber-500" />
                  <div>
                    <p className="text-sm font-medium">
                      The installer wrote the base PostgreSQL, Prisma, and local auth files into{' '}
                      <code>apps/api</code>.
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      Setup just aligned this machine with the Docker-backed Postgres database and
                      the first local login credentials.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-5">
                <p className="text-sm font-medium">Files prepared by setup</p>
                <div className="mt-4 space-y-3 text-sm text-muted">
                  <p>1. Connection strings were upserted into:</p>
                  <pre className="overflow-x-auto rounded-xl border border-[var(--border)] bg-black/30 p-4 text-xs text-slate-100">
                    <code>apps/api/.env</code>
                  </pre>
                  <p>2. Local auth values were added to the same env file:</p>
                  <pre className="overflow-x-auto rounded-xl border border-[var(--border)] bg-black/30 p-4 text-xs text-slate-100">
                    <code>LOCAL_AUTH_USERNAME / LOCAL_AUTH_PASSWORD_HASH / AUTH_JWT_SECRET</code>
                  </pre>
                  <p>3. Prisma schema was written to:</p>
                  <pre className="overflow-x-auto rounded-xl border border-[var(--border)] bg-black/30 p-4 text-xs text-slate-100">
                    <code>apps/api/prisma/schema.prisma</code>
                  </pre>
                  <p>4. Prisma client helper was written to:</p>
                  <pre className="overflow-x-auto rounded-xl border border-[var(--border)] bg-black/30 p-4 text-xs text-slate-100">
                    <code>apps/api/src/lib/prisma.ts</code>
                  </pre>
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={handlePrismaContinue}
                  className={cn('gap-2', SETUP_PRIMARY_BUTTON_CLASS)}
                >
                  Continue to migration checklist
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-5">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-500" />
                  <div>
                    <p className="text-sm font-medium">
                      Normal local startup now handles Postgres and Prisma bootstrap automatically.
                    </p>
                    <div className="mt-3 space-y-3 text-sm text-muted">
                      <p>1. Keep using the Docker-backed default database unless you intentionally replace it:</p>
                      <pre className="overflow-x-auto rounded-xl border border-[var(--border)] bg-black/30 p-4 text-xs text-slate-100">
                        <code>postgresql://postgres:postgres@127.0.0.1:5432/playrunner?schema=public</code>
                      </pre>
                      <p>2. The normal startup path now does this automatically before the API boots:</p>
                      <pre className="overflow-x-auto rounded-xl border border-[var(--border)] bg-black/30 p-4 text-xs text-slate-100">
                        <code>docker compose up -d postgres && npm run prisma:generate && npx prisma db push</code>
                      </pre>
                      <p>3. The login screen will now expect the username you just configured:</p>
                      <pre className="overflow-x-auto rounded-xl border border-[var(--border)] bg-black/30 p-4 text-xs text-slate-100">
                        <code>{setupForm.username || 'admin'}</code>
                      </pre>
                      <p>4. Finish setup, then rerun <code>./start-local.sh</code> if the product app is not already running.</p>
                    </div>
                  </div>
                </div>
              </div>

              {validationError && <p className="text-sm text-red-500">{validationError}</p>}

              <div className="flex justify-end">
                <Button
                  onClick={handleSetupComplete}
                  className={cn('gap-2', SETUP_PRIMARY_BUTTON_CLASS)}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Finishing setup...' : 'Finish setup'}
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
