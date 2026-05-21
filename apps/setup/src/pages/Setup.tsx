import {useMemo, useState} from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Database,
  Flame,
  FolderKanban,
  Sparkles,
} from 'lucide-react';
import {Button, Input, Textarea} from '@web/components/ui';
import {cn} from '@web/lib/utils';
import type {RuntimeFirebaseConfig, SetupPlatform} from '../lib/setup';
import {getActiveSetupSessionToken} from '../lib/setup';

type SetupStep =
  | 'platform'
  | 'firebaseDatabase'
  | 'firebaseApp'
  | 'firebaseDeploy'
  | 'firebaseAuth'
  | 'superbase';

type FirebaseFormState = RuntimeFirebaseConfig & {
  firestoreDatabaseId: string;
  firestoreLocation: string;
  rawConfig: string;
};

const EMPTY_FIREBASE_FORM: FirebaseFormState = {
  apiKey: '',
  appId: '',
  authDomain: '',
  firestoreDatabaseId: '(default)',
  firestoreLocation: 'nam5',
  measurementId: '',
  messagingSenderId: '',
  projectId: '',
  rawConfig: '',
  storageBucket: '',
};

const PLATFORM_OPTIONS: Array<{
  description: string;
  icon: string;
  id: SetupPlatform;
  status: string;
  title: string;
}> = [
  {
    id: 'firebase',
    title: 'Firebase',
    description: 'Configure authentication and Firestore from your Firebase project.',
    icon: '/images/integrations/firebase.svg',
    status: 'Ready now',
  },
  {
    id: 'superbase',
    title: 'Superbase',
    description: 'Placeholder flow for the upcoming Supabase-backed setup path.',
    icon: '/images/integrations/superbase.svg',
    status: 'Stub only',
  },
];

const SETUP_PRIMARY_BUTTON_CLASS =
  'border border-white/20 bg-white text-slate-950 shadow-sm hover:bg-slate-200';
const SETUP_GHOST_BUTTON_CLASS =
  'rounded-lg border-transparent bg-transparent text-white shadow-none hover:bg-white/10 hover:text-white';

function normalizeFirebaseConfig(form: FirebaseFormState): RuntimeFirebaseConfig {
  return {
    apiKey: form.apiKey.trim(),
    appId: form.appId.trim(),
    authDomain: form.authDomain.trim(),
    firestoreDatabaseId: form.firestoreDatabaseId.trim() || undefined,
    measurementId: form.measurementId.trim() || undefined,
    messagingSenderId: form.messagingSenderId.trim(),
    projectId: form.projectId.trim(),
    storageBucket: form.storageBucket.trim(),
  };
}

function parseFirebaseConfigInput(value: string): Partial<RuntimeFirebaseConfig> {
  const normalizedValue = value.replace(/\u00a0/g, ' ').trim();

  try {
    return JSON.parse(normalizedValue) as Partial<RuntimeFirebaseConfig>;
  } catch {
    const parsed = Function(`"use strict"; return (${normalizedValue});`)() as unknown;

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid Firebase config object.');
    }

    return parsed as Partial<RuntimeFirebaseConfig>;
  }
}

function getStepTitle(step: SetupStep) {
  switch (step) {
    case 'platform':
      return 'Choose a platform';
    case 'firebaseDatabase':
      return 'Configure Firestore';
    case 'firebaseApp':
      return 'Configure Firebase app';
    case 'firebaseDeploy':
      return 'Deploy Firestore config';
    case 'firebaseAuth':
      return 'Enable authentication';
    default:
      return 'Configure Firebase';
  }
}

export default function Setup() {
  const [step, setStep] = useState<SetupStep>('platform');
  const [platform, setPlatform] = useState<SetupPlatform | null>(null);
  const [firebaseForm, setFirebaseForm] = useState<FirebaseFormState>(EMPTY_FIREBASE_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const firebaseValidation = useMemo(() => {
    const config = normalizeFirebaseConfig(firebaseForm);
    const requiredFields: Array<keyof RuntimeFirebaseConfig> = [
      'projectId',
      'apiKey',
      'appId',
      'authDomain',
      'storageBucket',
      'messagingSenderId',
    ];

    return requiredFields.filter((field) => !config[field]);
  }, [firebaseForm]);

  const firestoreValidation = useMemo(() => {
    const missingFields: string[] = [];
    if (!firebaseForm.firestoreDatabaseId.trim()) {
      missingFields.push('firestoreDatabaseId');
    }
    if (!firebaseForm.firestoreLocation.trim()) {
      missingFields.push('firestoreLocation');
    }
    return missingFields;
  }, [firebaseForm.firestoreDatabaseId, firebaseForm.firestoreLocation]);

  const handlePlatformSelect = (nextPlatform: SetupPlatform) => {
    setPlatform(nextPlatform);
    setValidationError(null);

    setStep(nextPlatform === 'firebase' ? 'firebaseDatabase' : 'superbase');
  };

  const handleBack = () => {
    setValidationError(null);
    if (step === 'firebaseAuth') {
      setStep('firebaseDeploy');
      return;
    }
    if (step === 'firebaseDeploy') {
      setStep('firebaseApp');
      return;
    }
    if (step === 'firebaseApp') {
      setStep('firebaseDatabase');
      return;
    }
    setStep('platform');
  };

  const handleConfigPaste = (value: string) => {
    setFirebaseForm((current) => ({
      ...current,
      rawConfig: value,
    }));

    if (!value.trim()) {
      setJsonError(null);
      return;
    }

    try {
      const parsed = parseFirebaseConfigInput(value);
      setFirebaseForm((current) => ({
        ...current,
        apiKey: parsed.apiKey ?? current.apiKey,
        appId: parsed.appId ?? current.appId,
        authDomain: parsed.authDomain ?? current.authDomain,
        firestoreDatabaseId: parsed.firestoreDatabaseId ?? current.firestoreDatabaseId,
        measurementId: parsed.measurementId ?? current.measurementId,
        messagingSenderId: parsed.messagingSenderId ?? current.messagingSenderId,
        projectId: parsed.projectId ?? current.projectId,
        rawConfig: value,
        storageBucket: parsed.storageBucket ?? current.storageBucket,
      }));
      setJsonError(null);
    } catch {
      setJsonError('Could not parse that JSON config. You can still fill the fields manually.');
    }
  };

  const handleFirestoreContinue = () => {
    if (firestoreValidation.length > 0) {
      setValidationError(`Missing required fields: ${firestoreValidation.join(', ')}`);
      return;
    }

    setValidationError(null);
    setStep('firebaseApp');
  };

  const handleFirebaseContinue = async () => {
    if (firebaseValidation.length > 0) {
      setValidationError(`Missing required fields: ${firebaseValidation.join(', ')}`);
      return;
    }

    if (firestoreValidation.length > 0) {
      setValidationError(`Missing required fields: ${firestoreValidation.join(', ')}`);
      return;
    }

    const config = normalizeFirebaseConfig(firebaseForm);
    const setupSessionToken = getActiveSetupSessionToken();
    setValidationError(null);
    setIsSubmitting(true);

    try {
      if (!setupSessionToken) {
        throw new Error('Missing setup session token. Restart with an explicit setup launch.');
      }

      const response = await window.fetch(
        `/setup-api/setup/firebase/generate?token=${encodeURIComponent(setupSessionToken)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...config,
            firestoreDatabaseId: firebaseForm.firestoreDatabaseId.trim(),
            firestoreLocation: firebaseForm.firestoreLocation.trim(),
          }),
        },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {error?: string} | null;
        throw new Error(payload?.error ?? 'Failed to write Firebase setup files.');
      }

      setStep('firebaseDeploy');
    } catch (error) {
      setValidationError(
        error instanceof Error ? error.message : 'Failed to generate Firebase setup files.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFirebaseDeployContinue = () => {
    setValidationError(null);
    setStep('firebaseAuth');
  };

  const handleFirebaseSubmit = async () => {
    const config = normalizeFirebaseConfig(firebaseForm);
    const setupSessionToken = getActiveSetupSessionToken();
    setValidationError(null);
    setIsSubmitting(true);

    try {
      if (!setupSessionToken) {
        throw new Error('Missing setup session token. Restart with an explicit setup launch.');
      }

      const response = await window.fetch(
        `/setup-api/setup/firebase/complete?token=${encodeURIComponent(setupSessionToken)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...config,
            firestoreDatabaseId: firebaseForm.firestoreDatabaseId.trim(),
            firestoreLocation: firebaseForm.firestoreLocation.trim(),
          }),
        },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {error?: string} | null;
        throw new Error(payload?.error ?? 'Failed to finish Firebase setup.');
      }

      window.location.assign('/setup');
    } catch (error) {
      setValidationError(
        error instanceof Error ? error.message : 'Failed to finish Firebase setup.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen overflow-hidden bg-background text-[var(--foreground)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(239,68,68,0.14),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(59,130,246,0.12),_transparent_35%)]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col justify-center px-6 py-10 lg:flex-row lg:items-stretch lg:gap-10">
        <section className="mb-8 flex-1 rounded-[2rem] border border-[var(--border)] bg-[linear-gradient(160deg,rgba(17,24,39,0.96),rgba(15,23,42,0.92))] p-8 text-white shadow-2xl lg:mb-0 lg:p-10">
          <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/6 px-4 py-2 text-sm">
            <img src="/images/playrunner-icon.svg" alt="Playrail" className="h-5 w-5" />
            <span>Playrail first-run setup</span>
          </div>

          <h1 className="mt-8 max-w-xl text-4xl font-semibold tracking-tight">
            Connect the workspace before anyone reaches login.
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-slate-300">
            This install is in an explicit one-time setup session. Choose the backing platform,
            capture the project details, then generate the Firebase files needed by the product
            app.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
              <Flame className="h-5 w-5 text-orange-300" />
              <p className="mt-3 text-sm font-medium">Platform selection</p>
              <p className="mt-1 text-xs text-slate-300">Pick Firebase now or keep Superbase as a stub.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
              <FolderKanban className="h-5 w-5 text-cyan-300" />
              <p className="mt-3 text-sm font-medium">Project details</p>
              <p className="mt-1 text-xs text-slate-300">Capture project ID and the web app config fields.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
              <CheckCircle2 className="h-5 w-5 text-emerald-300" />
              <p className="mt-3 text-sm font-medium">Install handoff</p>
              <p className="mt-1 text-xs text-slate-300">Write the config into apps/web, then close setup permanently.</p>
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
            {step !== 'platform' && (
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

          {step === 'platform' ? (
            <div className="space-y-4">
              {PLATFORM_OPTIONS.map((option) => {
                const isSelected = platform === option.id;

                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => handlePlatformSelect(option.id)}
                    className={cn(
                      'w-full rounded-[1.5rem] border p-5 text-left transition-all',
                      isSelected
                        ? 'border-[var(--foreground)] bg-[var(--background)] shadow-lg'
                        : 'border-[var(--border)] bg-[var(--background)] hover:border-[var(--border-strong)] hover:bg-[var(--control-bg)]',
                    )}
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--surface)]">
                        <img src={option.icon} alt={option.title} className="h-8 w-8 object-contain" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-3">
                              <h3 className="min-w-0 text-lg font-semibold">{option.title}</h3>
                              <span className="shrink-0 whitespace-nowrap rounded-full border border-[var(--border)] px-3 py-1 text-xs text-muted">
                                {option.status}
                              </span>
                            </div>
                            <p className="mt-1 text-sm text-muted">{option.description}</p>
                          </div>
                        </div>
                        <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium">
                          Continue
                          <ChevronRight className="h-4 w-4" />
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : step === 'firebaseDatabase' ? (
            <div className="space-y-6">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
                <div className="flex items-start gap-3">
                  <Database className="mt-0.5 h-5 w-5 text-sky-500" />
                  <div>
                    <p className="text-sm font-medium">Capture the Firestore database before the app config.</p>
                    <p className="mt-1 text-sm text-muted">
                      Use the exact database name and region from Firebase. These values will be written into <code>firebase.json</code>.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium">Firestore database name</label>
                  <Input
                    placeholder="(default)"
                    value={firebaseForm.firestoreDatabaseId}
                    onChange={(event) =>
                      setFirebaseForm((current) => ({
                        ...current,
                        firestoreDatabaseId: event.target.value,
                      }))
                    }
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium">Firestore location</label>
                  <Input
                    placeholder="nam5"
                    value={firebaseForm.firestoreLocation}
                    onChange={(event) =>
                      setFirebaseForm((current) => ({
                        ...current,
                        firestoreLocation: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              {validationError && <p className="text-sm text-red-500">{validationError}</p>}

              <div className="flex justify-end">
                <Button
                  onClick={handleFirestoreContinue}
                  className={cn('gap-2', SETUP_PRIMARY_BUTTON_CLASS)}
                >
                  Continue to app config
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : step === 'firebaseApp' ? (
            <div className="space-y-6">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
                <div className="flex items-start gap-3">
                  <Sparkles className="mt-0.5 h-5 w-5 text-amber-500" />
                  <div>
                    <p className="text-sm font-medium">Paste the Firebase web config if you already have it.</p>
                    <p className="mt-1 text-sm text-muted">
                      The parser will prefill the fields below. You can also skip the JSON and answer each question manually.
                    </p>
                  </div>
                </div>
                <Textarea
                  rows={6}
                  className="mt-4 font-mono text-xs"
                  placeholder='{"projectId":"...","appId":"...","apiKey":"..."}'
                  value={firebaseForm.rawConfig}
                  onChange={(event) => handleConfigPaste(event.target.value)}
                />
                {jsonError && <p className="mt-2 text-sm text-red-500">{jsonError}</p>}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-medium">Firebase project ID</label>
                  <Input
                    placeholder="your-firebase-project"
                    value={firebaseForm.projectId}
                    onChange={(event) =>
                      setFirebaseForm((current) => ({...current, projectId: event.target.value}))
                    }
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-medium">Web app API key</label>
                  <Input
                    placeholder="AIza..."
                    value={firebaseForm.apiKey}
                    onChange={(event) =>
                      setFirebaseForm((current) => ({...current, apiKey: event.target.value}))
                    }
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium">App ID</label>
                  <Input
                    placeholder="1:1234567890:web:abcdef"
                    value={firebaseForm.appId}
                    onChange={(event) =>
                      setFirebaseForm((current) => ({...current, appId: event.target.value}))
                    }
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium">Messaging sender ID</label>
                  <Input
                    placeholder="1234567890"
                    value={firebaseForm.messagingSenderId}
                    onChange={(event) =>
                      setFirebaseForm((current) => ({
                        ...current,
                        messagingSenderId: event.target.value,
                      }))
                    }
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium">Auth domain</label>
                  <Input
                    placeholder="your-project.firebaseapp.com"
                    value={firebaseForm.authDomain}
                    onChange={(event) =>
                      setFirebaseForm((current) => ({...current, authDomain: event.target.value}))
                    }
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium">Storage bucket</label>
                  <Input
                    placeholder="your-project.firebasestorage.app"
                    value={firebaseForm.storageBucket}
                    onChange={(event) =>
                      setFirebaseForm((current) => ({...current, storageBucket: event.target.value}))
                    }
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium">Measurement ID</label>
                  <Input
                    placeholder="G-XXXXXXXXXX"
                    value={firebaseForm.measurementId}
                    onChange={(event) =>
                      setFirebaseForm((current) => ({
                        ...current,
                        measurementId: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
                <div className="flex items-center gap-3">
                  <Database className="h-5 w-5 text-sky-500" />
                  <p className="text-sm text-muted">
                    Clicking next will generate the Firebase config files in <code>apps/web</code>
                    so you can deploy the Firestore rules and indexes in the following step.
                  </p>
                </div>
              </div>

              {validationError && <p className="text-sm text-red-500">{validationError}</p>}

              <div className="flex justify-end">
                <Button
                  onClick={handleFirebaseContinue}
                  className={cn('gap-2', SETUP_PRIMARY_BUTTON_CLASS)}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Generating config...' : 'Generate config and continue'}
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : step === 'firebaseDeploy' ? (
            <div className="space-y-6">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
                <div className="flex items-start gap-3">
                  <Database className="mt-0.5 h-5 w-5 text-sky-500" />
                  <div>
                    <p className="text-sm font-medium">Deploy the generated Firestore rules and indexes before auth setup.</p>
                    <p className="mt-1 text-sm text-muted">
                      This ensures the project has the expected rules and composite indexes before anyone starts using Firestore.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-5">
                <p className="text-sm font-medium">Firestore deploy checklist</p>
                <div className="mt-4 space-y-3 text-sm text-muted">
                  <p>1. From the repo root, run:</p>
                  <pre className="overflow-x-auto rounded-xl border border-[var(--border)] bg-black/30 p-4 text-xs text-slate-100">
                    <code>cd apps/web</code>
                  </pre>
                  <p>2. Deploy the generated rules and indexes:</p>
                  <pre className="overflow-x-auto rounded-xl border border-[var(--border)] bg-black/30 p-4 text-xs text-slate-100">
                    <code>firebase deploy --only firestore:rules,firestore:indexes</code>
                  </pre>
                  <p>3. Make sure the deploy succeeds before you continue, otherwise Firestore auth and query behavior may be wrong.</p>
                </div>
              </div>

              {validationError && <p className="text-sm text-red-500">{validationError}</p>}

              <div className="flex justify-end">
                <Button
                  onClick={handleFirebaseDeployContinue}
                  className={cn('gap-2', SETUP_PRIMARY_BUTTON_CLASS)}
                >
                  Continue to authentication
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : step === 'firebaseAuth' ? (
            <div className="space-y-6">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-5">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-500" />
                  <div>
                    <p className="text-sm font-medium">Enable Firebase Authentication before finishing setup.</p>
                    <div className="mt-3 space-y-3 text-sm text-muted">
                      <p>1. Open Firebase Console for this project.</p>
                      <p>2. Go to Authentication.</p>
                      <p>3. Enable the Google provider.</p>
                      <p>4. Enable the GitHub provider.</p>
                      <p>5. Confirm both providers are saved before you click finish.</p>
                    </div>
                  </div>
                </div>
              </div>

              {validationError && <p className="text-sm text-red-500">{validationError}</p>}

              <div className="flex justify-end">
                <Button
                  onClick={handleFirebaseSubmit}
                  className={cn('gap-2', SETUP_PRIMARY_BUTTON_CLASS)}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Finishing setup...' : 'Finish setup'}
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--background)] p-8 text-center">
              <p className="text-base font-medium">Supabase setup is not implemented yet.</p>
              <p className="mt-2 text-sm text-muted">
                The Firebase path is the only production-ready flow in this installer right now.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
