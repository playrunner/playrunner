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
import {Badge, Button, Input} from '@web/components/ui';
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

const STEP_SEQUENCE = [
  {
    description: 'Write the datasource URLs and the first local username/password.',
    id: 'postgres' as const,
    label: 'Step 1',
    icon: Database,
    title: 'Configure PostgreSQL',
  },
  {
    description: 'Confirm which Prisma and runtime files setup wrote into apps/api.',
    id: 'prisma' as const,
    label: 'Step 2',
    icon: Sparkles,
    title: 'Review Prisma scaffold',
  },
  {
    description: 'Finish the bootstrap and confirm the normal local startup path.',
    id: 'complete' as const,
    label: 'Step 3',
    icon: CheckCircle2,
    title: 'Finish local bootstrap',
  },
];

const SURFACE_CARD_CLASS = 'rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm';
const INSET_CARD_CLASS = 'rounded-xl border border-[var(--border)] bg-[var(--background)]';
const CODE_BLOCK_CLASS =
  'overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] p-3 font-mono text-xs text-[var(--foreground)]';
const SECTION_LABEL_CLASS = 'text-xs font-semibold uppercase tracking-[0.24em] text-muted';

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

  const activeStepIndex = STEP_SEQUENCE.findIndex((candidate) => candidate.id === step);

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
    <div className="min-h-screen bg-background text-[var(--foreground)] font-sans">
      <div className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-12">
        <header className="border-b border-subtle pb-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-4">
              <Badge variant="outline" className="w-fit gap-2 px-3 py-1">
                <img
                  src="/images/playrunner-icon.svg"
                  alt="Playrunner"
                  className="h-4 w-4 object-contain"
                />
                First-run setup
              </Badge>
              <div className="space-y-2">
                <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-[var(--foreground)]">
                  Point this workspace at PostgreSQL and seed the first local login.
                </h1>
                <p className="max-w-3xl text-sm leading-relaxed text-muted">
                  This explicit setup session writes PostgreSQL connection strings, the first local
                  username/password pair, and the base Prisma scaffold into{' '}
                  <code className="font-mono text-xs text-[var(--foreground)]">apps/api</code>.
                </p>
              </div>
            </div>

            <div className={cn(SURFACE_CARD_CLASS, 'w-full max-w-sm p-4')}>
              <p className="text-sm font-medium text-[var(--foreground)]">What this installer changes</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                If{' '}
                <code className="font-mono text-xs text-[var(--foreground)]">apps/api/.env</code>{' '}
                is missing, setup creates it from{' '}
                <code className="font-mono text-xs text-[var(--foreground)]">
                  apps/api/.env.example
                </code>
                , then upserts the database, local auth, and Prisma runtime values.
              </p>
            </div>
          </div>
        </header>

        <div className="mt-8 grid gap-6 lg:grid-cols-[0.95fr_1.2fr]">
          <aside className="space-y-6">
            <section className={cn(SURFACE_CARD_CLASS, 'p-6')}>
              <div className="border-b border-subtle pb-3">
                <h2 className="mb-1 text-xl font-medium text-[var(--foreground)]">Install checklist</h2>
                <p className="text-sm text-muted">
                  Keep the setup flow on the same surfaces, spacing, and form language as the rest
                  of the app.
                </p>
              </div>

              <div className="mt-5 grid gap-3">
                <div className={cn(INSET_CARD_CLASS, 'p-4')}>
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-hover)]">
                      <Database className="h-4 w-4 text-[var(--foreground)]" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[var(--foreground)]">PostgreSQL connection</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted">
                        Capture the Prisma datasource URL and any direct or shadow database
                        overrides.
                      </p>
                    </div>
                  </div>
                </div>

                <div className={cn(INSET_CARD_CLASS, 'p-4')}>
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-hover)]">
                      <LockKeyhole className="h-4 w-4 text-[var(--foreground)]" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[var(--foreground)]">Local login seed</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted">
                        Hash the first username/password pair and store the runtime auth settings
                        in <code className="font-mono text-[11px] text-[var(--foreground)]">apps/api/.env</code>.
                      </p>
                    </div>
                  </div>
                </div>

                <div className={cn(INSET_CARD_CLASS, 'p-4')}>
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-hover)]">
                      <FolderKanban className="h-4 w-4 text-[var(--foreground)]" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[var(--foreground)]">Automatic bootstrap</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted">
                        Normal local startup now brings up Postgres and runs Prisma bootstrap
                        before the API comes online.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className={cn(SURFACE_CARD_CLASS, 'p-6')}>
              <p className={SECTION_LABEL_CLASS}>After setup</p>
              <h2 className="mt-2 text-xl font-medium text-[var(--foreground)]">
                Normal local startup
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                After the installer completes, stop the setup session and run the normal app. That
                path starts Postgres, generates Prisma client code, and pushes the current schema
                before the API boots.
              </p>
              <pre className={cn(CODE_BLOCK_CLASS, 'mt-4')}>
                <code>./start-local.sh</code>
              </pre>
            </section>
          </aside>

          <section className={cn(SURFACE_CARD_CLASS, 'p-6 md:p-8')}>
            <div className="flex flex-col gap-4 border-b border-subtle pb-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className={SECTION_LABEL_CLASS}>Setup wizard</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--foreground)]">
                  {getStepTitle(step)}
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
                  Store the required runtime values, review the generated files, then finish the
                  local bootstrap path.
                </p>
              </div>
              {step !== 'postgres' && (
                <Button variant="secondary" onClick={handleBack} className="gap-2 self-start">
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </Button>
              )}
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-3">
              {STEP_SEQUENCE.map((item, index) => {
                const isCurrent = index === activeStepIndex;
                const isComplete = index < activeStepIndex;
                const Icon = item.icon;

                return (
                  <div
                    key={item.id}
                    className={cn(
                      'rounded-xl border p-4 transition-colors',
                      isCurrent
                        ? 'border-[var(--border-strong)] bg-[var(--background)]'
                        : 'border-[var(--border)] bg-[var(--surface-hover)]/60',
                    )}
                  >
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-hover)]">
                        <Icon className="h-4 w-4 text-[var(--foreground)]" />
                      </div>
                      <Badge variant={isComplete ? 'success' : isCurrent ? 'default' : 'outline'}>
                        {isComplete ? 'Completed' : isCurrent ? 'Current' : item.label}
                      </Badge>
                    </div>
                    <h3 className="text-sm font-medium text-[var(--foreground)]">{item.title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted">{item.description}</p>
                  </div>
                );
              })}
            </div>

            <div className="mt-6">
              {step === 'postgres' ? (
                <div className="space-y-6">
                  <div className={cn(INSET_CARD_CLASS, 'p-5')}>
                    <div className="flex items-start gap-3">
                      <Database className="mt-0.5 h-5 w-5 text-[var(--foreground)]" />
                      <div>
                        <p className="text-sm font-medium text-[var(--foreground)]">
                          Paste the Prisma connection strings that should land in{' '}
                          <code className="font-mono text-xs text-[var(--foreground)]">apps/api/.env</code>,
                          then choose the first local login.
                        </p>
                        <p className="mt-2 text-sm leading-relaxed text-muted">
                          <code className="font-mono text-xs text-[var(--foreground)]">DATABASE_URL</code>{' '}
                          is required. Use{' '}
                          <code className="font-mono text-xs text-[var(--foreground)]">DIRECT_URL</code>{' '}
                          only when your runtime connection differs from the migration connection,
                          and{' '}
                          <code className="font-mono text-xs text-[var(--foreground)]">
                            SHADOW_DATABASE_URL
                          </code>{' '}
                          when you keep a dedicated Prisma shadow database.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-6 xl:grid-cols-[1.15fr_0.9fr]">
                    <div className={cn(INSET_CARD_CLASS, 'p-5')}>
                      <div className="border-b border-subtle pb-3">
                        <h3 className="text-sm font-medium text-[var(--foreground)]">
                          Connection strings
                        </h3>
                        <p className="mt-1 text-sm text-muted">
                          Store the runtime datasource first, then add direct or shadow URLs only
                          if your environment needs them.
                        </p>
                      </div>

                      <div className="mt-5 space-y-4">
                        <div className="space-y-1.5">
                          <label className="block text-sm font-medium text-[var(--foreground)]">
                            DATABASE_URL
                          </label>
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

                        <div className="space-y-1.5">
                          <label className="block text-sm font-medium text-[var(--foreground)]">
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

                        <div className="space-y-1.5">
                          <label className="block text-sm font-medium text-[var(--foreground)]">
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
                      </div>
                    </div>

                    <div className={cn(INSET_CARD_CLASS, 'p-5')}>
                      <div className="border-b border-subtle pb-3">
                        <h3 className="text-sm font-medium text-[var(--foreground)]">Local login</h3>
                        <p className="mt-1 text-sm text-muted">
                          These credentials become the local app login after setup completes.
                        </p>
                      </div>

                      <div className="mt-5 space-y-4">
                        <div className="space-y-1.5">
                          <label className="block text-sm font-medium text-[var(--foreground)]">
                            LOCAL_AUTH_USERNAME
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
                            LOCAL_AUTH_PASSWORD
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
                    </div>
                  </div>

                  {validationError && (
                    <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-500">
                      {validationError}
                    </div>
                  )}

                  <div className="flex justify-end">
                    <Button
                      variant="primary"
                      onClick={handlePostgresContinue}
                      className="gap-2"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? 'Writing setup files...' : 'Write runtime scaffold'}
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : step === 'prisma' ? (
                <div className="space-y-6">
                  <div className={cn(INSET_CARD_CLASS, 'p-5')}>
                    <div className="flex items-start gap-3">
                      <Sparkles className="mt-0.5 h-5 w-5 text-[var(--foreground)]" />
                      <div>
                        <p className="text-sm font-medium text-[var(--foreground)]">
                          The installer wrote the base PostgreSQL, Prisma, and local auth files
                          into <code className="font-mono text-xs text-[var(--foreground)]">apps/api</code>.
                        </p>
                        <p className="mt-2 text-sm leading-relaxed text-muted">
                          Setup just aligned this machine with the Docker-backed Postgres database
                          and the first local login credentials.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className={cn(INSET_CARD_CLASS, 'p-4')}>
                      <p className="text-sm font-medium text-[var(--foreground)]">Connection strings</p>
                      <p className="mt-1 text-xs text-muted">Upserted into the runtime env file.</p>
                      <pre className={cn(CODE_BLOCK_CLASS, 'mt-3')}>
                        <code>apps/api/.env</code>
                      </pre>
                    </div>

                    <div className={cn(INSET_CARD_CLASS, 'p-4')}>
                      <p className="text-sm font-medium text-[var(--foreground)]">Local auth values</p>
                      <p className="mt-1 text-xs text-muted">
                        Added to the same env file for local login.
                      </p>
                      <pre className={cn(CODE_BLOCK_CLASS, 'mt-3')}>
                        <code>LOCAL_AUTH_USERNAME / LOCAL_AUTH_PASSWORD_HASH / AUTH_JWT_SECRET</code>
                      </pre>
                    </div>

                    <div className={cn(INSET_CARD_CLASS, 'p-4')}>
                      <p className="text-sm font-medium text-[var(--foreground)]">Prisma schema</p>
                      <p className="mt-1 text-xs text-muted">Written for the PostgreSQL runtime.</p>
                      <pre className={cn(CODE_BLOCK_CLASS, 'mt-3')}>
                        <code>apps/api/prisma/schema.prisma</code>
                      </pre>
                    </div>

                    <div className={cn(INSET_CARD_CLASS, 'p-4')}>
                      <p className="text-sm font-medium text-[var(--foreground)]">Prisma client helper</p>
                      <p className="mt-1 text-xs text-muted">
                        Updated so the API runtime can talk to Prisma directly.
                      </p>
                      <pre className={cn(CODE_BLOCK_CLASS, 'mt-3')}>
                        <code>apps/api/src/lib/prisma.ts</code>
                      </pre>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button variant="primary" onClick={handlePrismaContinue} className="gap-2">
                      Continue to migration checklist
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className={cn(INSET_CARD_CLASS, 'p-5')}>
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-500" />
                      <div>
                        <p className="text-sm font-medium text-[var(--foreground)]">
                          Normal local startup now handles Postgres and Prisma bootstrap
                          automatically.
                        </p>
                        <p className="mt-2 text-sm leading-relaxed text-muted">
                          Finish setup, then switch back to the normal startup path if the product
                          app is not already running.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3">
                    <div className={cn(INSET_CARD_CLASS, 'p-4')}>
                      <p className="text-sm font-medium text-[var(--foreground)]">1. Default local database</p>
                      <p className="mt-1 text-xs text-muted">
                        Keep using the Docker-backed default unless you intentionally replace it.
                      </p>
                      <pre className={cn(CODE_BLOCK_CLASS, 'mt-3')}>
                        <code>postgresql://postgres:postgres@127.0.0.1:5432/playrunner?schema=public</code>
                      </pre>
                    </div>

                    <div className={cn(INSET_CARD_CLASS, 'p-4')}>
                      <p className="text-sm font-medium text-[var(--foreground)]">2. Automatic bootstrap path</p>
                      <p className="mt-1 text-xs text-muted">
                        The normal startup path now performs this bootstrap before the API boots.
                      </p>
                      <pre className={cn(CODE_BLOCK_CLASS, 'mt-3')}>
                        <code>docker compose up -d postgres && npm run prisma:generate && npx prisma db push</code>
                      </pre>
                    </div>

                    <div className={cn(INSET_CARD_CLASS, 'p-4')}>
                      <p className="text-sm font-medium text-[var(--foreground)]">3. Local login expectation</p>
                      <p className="mt-1 text-xs text-muted">
                        The login screen now expects the username you just configured.
                      </p>
                      <pre className={cn(CODE_BLOCK_CLASS, 'mt-3')}>
                        <code>{setupForm.username || 'admin'}</code>
                      </pre>
                    </div>
                  </div>

                  {validationError && (
                    <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-500">
                      {validationError}
                    </div>
                  )}

                  <div className="flex justify-end">
                    <Button
                      variant="primary"
                      onClick={handleSetupComplete}
                      className="gap-2"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? 'Finishing setup...' : 'Finish setup'}
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
