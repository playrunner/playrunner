import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Database,
  FolderKanban,
  LockKeyhole,
  Sparkles,
} from 'lucide-react';
import { Badge, Button, Input } from '@frontend/components/ui';
import { cn } from '@frontend/lib/utils';
import type { RuntimeSetupConfig } from '../lib/setup';
import { getActiveSetupSessionToken } from '../lib/setup';

type SetupStep = 'intro' | 'postgres' | 'complete';

type SetupFormState = Omit<
  RuntimeSetupConfig,
  'directUrl' | 'shadowDatabaseUrl'
> & {
  confirmPassword: string;
};

const EMPTY_SETUP_FORM: SetupFormState = {
  databaseUrl:
    'postgresql://postgres:postgres@127.0.0.1:5432/playrunner?schema=public',
  username: 'admin',
  password: '',
  confirmPassword: '',
};

const STEP_SEQUENCE = [
  {
    description: 'See what setup changes before editing any runtime config.',
    id: 'intro' as const,
    label: 'Step 1',
    icon: Sparkles,
    title: 'Overview',
  },
  {
    description: 'Enter the database and first local login details.',
    id: 'postgres' as const,
    label: 'Step 2',
    icon: Database,
    title: 'Configuration',
  },
  {
    description: 'Finish setup and return to the normal startup path.',
    id: 'complete' as const,
    label: 'Step 3',
    icon: CheckCircle2,
    title: 'Complete',
  },
];

const SURFACE_CARD_CLASS =
  'rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm';
const INSET_CARD_CLASS =
  'rounded-xl border border-[var(--border)] bg-[var(--background)]';
const CODE_BLOCK_CLASS =
  'overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] p-3 font-mono text-xs text-[var(--foreground)]';
const SECTION_LABEL_CLASS =
  'text-xs font-semibold uppercase tracking-[0.24em] text-muted';

function getStepTitle(step: SetupStep) {
  switch (step) {
    case 'intro':
      return 'Review the local install';
    case 'postgres':
      return 'Configure PostgreSQL';
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
    username: form.username.trim(),
    password: form.password,
  };
}

export default function Setup() {
  const [step, setStep] = useState<SetupStep>('intro');
  const [setupForm, setSetupForm] = useState<SetupFormState>(EMPTY_SETUP_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const activeStepIndex = STEP_SEQUENCE.findIndex(
    (candidate) => candidate.id === step,
  );

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

    if (
      setupForm.databaseUrl.trim() &&
      !isValidPostgresUrl(setupForm.databaseUrl)
    ) {
      fields.push('DATABASE_URL');
    }

    return fields;
  }, [setupForm.databaseUrl]);

  const handleBack = () => {
    setValidationError(null);

    if (step === 'complete') {
      setStep('postgres');
      return;
    }

    if (step === 'postgres') {
      setStep('intro');
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
      setValidationError(
        'Missing setup session token. Restart with an explicit setup launch.',
      );
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
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
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

  const handleIntroContinue = () => {
    setValidationError(null);
    setStep('postgres');
  };

  const handlePostgresContinue = async () => {
    const succeeded = await submitSetupStep('generate');
    if (succeeded) {
      setStep('complete');
    }
  };

  const handleSetupComplete = async () => {
    const succeeded = await submitSetupStep('complete');
    if (succeeded) {
      window.location.assign('/setup');
    }
  };

  return (
    <div className="min-h-screen bg-background text-[var(--foreground)] font-sans">
      <div className="mx-auto max-w-5xl px-5 py-8 md:px-8 md:py-12">
        <header className="border-b border-subtle pb-6">
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
                Point this workspace at PostgreSQL and seed the first local
                login.
              </h1>
              <p className="max-w-3xl text-sm leading-relaxed text-muted">
                Setup writes the local database, auth, and Prisma runtime values
                into{' '}
                <code className="font-mono text-xs text-[var(--foreground)]">
                  apps/api
                </code>
                .
              </p>
            </div>
          </div>
        </header>

        <div className="mt-8 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <aside className="space-y-6">
            <section className={cn(SURFACE_CARD_CLASS, 'p-6')}>
              <div className="border-b border-subtle pb-3">
                <h2 className="mb-1 text-xl font-medium text-[var(--foreground)]">
                  Setup flow
                </h2>
                <p className="text-sm text-muted">
                  Short overview first, then the form, then a final handoff back
                  to normal local startup.
                </p>
              </div>

              <div className="mt-5 grid gap-3">
                {STEP_SEQUENCE.map((item, index) => {
                  const Icon = item.icon;
                  const isCurrent = index === activeStepIndex;
                  const isComplete = index < activeStepIndex;

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
                        <Badge
                          variant={
                            isComplete
                              ? 'success'
                              : isCurrent
                                ? 'default'
                                : 'outline'
                          }
                        >
                          {isComplete
                            ? 'Completed'
                            : isCurrent
                              ? 'Current'
                              : item.label}
                        </Badge>
                      </div>
                      <h3 className="text-sm font-medium text-[var(--foreground)]">
                        {item.title}
                      </h3>
                      <p className="mt-1 text-xs leading-relaxed text-muted">
                        {item.description}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className={cn(SURFACE_CARD_CLASS, 'p-6')}>
              <p className={SECTION_LABEL_CLASS}>Normal startup</p>
              <h2 className="mt-2 text-xl font-medium text-[var(--foreground)]">
                After setup
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                The standard local path starts Postgres, generates the Prisma
                client, and pushes the current schema before the API boots.
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
              </div>
              {step !== 'intro' && (
                <Button
                  variant="secondary"
                  onClick={handleBack}
                  className="gap-2 self-start"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </Button>
              )}
            </div>

            <div className="mt-6">
              {step === 'intro' ? (
                <div className="space-y-6">
                  <div className={cn(INSET_CARD_CLASS, 'p-5')}>
                    <div className="flex items-start gap-3">
                      <Sparkles className="mt-0.5 h-5 w-5 text-[var(--foreground)]" />
                      <div>
                        <p className="text-sm font-medium text-[var(--foreground)]">
                          If you are using the standard local stack, the
                          defaults already point at the Docker-backed Postgres
                          database.
                        </p>
                        <p className="mt-2 text-sm leading-relaxed text-muted">
                          You only need to change the connection values if you
                          want setup to target a different database or keep
                          separate direct and shadow URLs.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className={cn(INSET_CARD_CLASS, 'p-4')}>
                      <Database className="h-4 w-4 text-[var(--foreground)]" />
                      <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
                        Database runtime
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-muted">
                        Save the Prisma datasource URL into the local API env
                        file.
                      </p>
                    </div>

                    <div className={cn(INSET_CARD_CLASS, 'p-4')}>
                      <LockKeyhole className="h-4 w-4 text-[var(--foreground)]" />
                      <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
                        First login
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-muted">
                        Create the first local username and password for the app
                        login screen.
                      </p>
                    </div>

                    <div className={cn(INSET_CARD_CLASS, 'p-4')}>
                      <FolderKanban className="h-4 w-4 text-[var(--foreground)]" />
                      <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
                        Prisma scaffold
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-muted">
                        Write the base runtime files into{' '}
                        <code className="font-mono text-[11px] text-[var(--foreground)]">
                          apps/api
                        </code>
                        .
                      </p>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button
                      variant="primary"
                      onClick={handleIntroContinue}
                      className="gap-2"
                    >
                      Continue to configuration
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : step === 'postgres' ? (
                <div className="space-y-6">
                  <div className={cn(INSET_CARD_CLASS, 'p-5')}>
                    <div className="flex items-start gap-3">
                      <Database className="mt-0.5 h-5 w-5 text-[var(--foreground)]" />
                      <div>
                        <p className="text-sm font-medium text-[var(--foreground)]">
                          Enter the main database URL and the first local login.
                        </p>
                        <p className="mt-2 text-sm leading-relaxed text-muted">
                          Keep the default value for the local Docker-backed
                          database, or replace it with your own PostgreSQL
                          instance.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className={cn(INSET_CARD_CLASS, 'p-5')}>
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
                          Username
                        </label>
                        <p className="text-xs text-muted">
                          <code className="font-mono text-[11px] text-[var(--foreground)]">
                            LOCAL_AUTH_USERNAME
                          </code>
                        </p>
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
                          Password
                        </label>
                        <p className="text-xs text-muted">
                          <code className="font-mono text-[11px] text-[var(--foreground)]">
                            LOCAL_AUTH_PASSWORD
                          </code>
                        </p>
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
                      onClick={handlePostgresContinue}
                      className="gap-2"
                      disabled={isSubmitting}
                    >
                      {isSubmitting
                        ? 'Writing setup files...'
                        : 'Write runtime scaffold'}
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
                          The runtime scaffold is ready.
                        </p>
                        <p className="mt-2 text-sm leading-relaxed text-muted">
                          Finish setup to lock the installer and switch back to
                          the normal local startup flow.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className={cn(INSET_CARD_CLASS, 'p-4')}>
                      <p className="text-sm font-medium text-[var(--foreground)]">
                        Run next
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        Use the standard startup path for normal local
                        development.
                      </p>
                      <pre className={cn(CODE_BLOCK_CLASS, 'mt-3')}>
                        <code>./start-local.sh</code>
                      </pre>
                    </div>

                    <div className={cn(INSET_CARD_CLASS, 'p-4')}>
                      <p className="text-sm font-medium text-[var(--foreground)]">
                        Login username
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        The local login screen will expect this username.
                      </p>
                      <pre className={cn(CODE_BLOCK_CLASS, 'mt-3')}>
                        <code>{setupForm.username || 'admin'}</code>
                      </pre>
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
