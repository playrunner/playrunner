import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { CheckCircle2, LockKeyhole, Sparkles } from 'lucide-react';
import { ThemeProvider } from '@frontend/components/ThemeProvider';
import { Badge } from '@frontend/components/ui';
import Setup from './pages/Setup';
import { detectSetupMode } from './lib/setup';

type BootState = 'booting' | 'ready' | 'locked' | 'completed';

const SHELL_CARD_CLASS =
  'w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 shadow-sm';
const CODE_BLOCK_CLASS =
  'overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] p-3 font-mono text-sm text-[var(--foreground)]';

function SetupShell() {
  const [bootState, setBootState] = useState<BootState>('booting');

  useEffect(() => {
    let isMounted = true;

    detectSetupMode().then((status) => {
      if (!isMounted) return;

      if (status.enabled) {
        setBootState('ready');
        return;
      }

      setBootState(status.completed ? 'completed' : 'locked');
    });

    return () => {
      isMounted = false;
    };
  }, []);

  if (bootState === 'booting') {
    return (
      <div className="min-h-screen bg-background text-[var(--foreground)] font-sans">
        <div className="mx-auto flex min-h-screen max-w-2xl items-center px-6 py-12">
          <div className={SHELL_CARD_CLASS}>
            <Badge variant="outline" className="gap-2 px-3 py-1">
              <Sparkles className="h-3.5 w-3.5" />
              Preparing setup
            </Badge>
            <img
              src="/images/playrunner-icon.svg"
              alt="Playrunner"
              className="mt-5 h-12 w-12 object-contain"
            />
            <h1 className="mt-5 text-3xl font-semibold tracking-tight">
              Preparing setup
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
              Checking whether this machine is in an explicit one-time setup
              session.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (bootState === 'locked' || bootState === 'completed') {
    const isCompleted = bootState === 'completed';

    return (
      <div className="min-h-screen bg-background text-[var(--foreground)] font-sans">
        <div className="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-12">
          <div className={SHELL_CARD_CLASS}>
            <Badge
              variant={isCompleted ? 'success' : 'outline'}
              className="gap-2 px-3 py-1"
            >
              {isCompleted ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <LockKeyhole className="h-3.5 w-3.5" />
              )}
              {isCompleted ? 'Setup completed' : 'Setup is locked'}
            </Badge>

            <h1 className="mt-5 text-3xl font-semibold tracking-tight text-[var(--foreground)]">
              {isCompleted ? 'Setup Completed' : 'Setup Is Locked'}
            </h1>

            <div className="mt-5 space-y-4 text-sm leading-relaxed text-muted">
              {isCompleted ? (
                <>
                  <p>
                    The installer has already completed once and is now disabled
                    for this session.
                  </p>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
                    <p className="text-sm font-medium text-[var(--foreground)]">
                      Run next
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      Stop this setup session and start the normal local app
                      instead.
                    </p>
                    <pre className={CODE_BLOCK_CLASS}>
                      <code>./start-local.sh</code>
                    </pre>
                  </div>
                </>
              ) : (
                <>
                  <p>
                    This setup app only opens during an explicit one-time setup
                    run.
                  </p>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
                    <p className="text-sm font-medium text-[var(--foreground)]">
                      Open a setup session
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      Start the installer explicitly, then open the setup route
                      in the browser.
                    </p>
                    <pre className={CODE_BLOCK_CLASS}>
                      <code>./start-local.sh --setup</code>
                    </pre>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/setup" element={<Setup />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
      <SetupShell />
    </ThemeProvider>
  );
}
