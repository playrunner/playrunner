import {useEffect, useState} from 'react';
import {BrowserRouter, Navigate, Route, Routes} from 'react-router-dom';
import {ThemeProvider} from '@web/components/ThemeProvider';
import Setup from './pages/Setup';
import {detectSetupMode} from './lib/setup';

type BootState = 'booting' | 'ready' | 'locked' | 'completed';

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
      <div className="min-h-screen bg-background text-[var(--foreground)] flex items-center justify-center px-6">
        <div className="w-full max-w-md rounded-3xl border border-[var(--border)] bg-[var(--surface)]/80 p-8 text-center shadow-2xl backdrop-blur">
          <img
            src="/images/playrunner-icon.svg"
            alt="Playrail"
            className="mx-auto mb-5 h-12 w-12 object-contain"
          />
          <h1 className="text-xl font-semibold tracking-tight">Preparing setup</h1>
          <p className="mt-2 text-sm text-muted">
            Checking whether this machine is in an explicit one-time setup session.
          </p>
        </div>
      </div>
    );
  }

  if (bootState === 'locked' || bootState === 'completed') {
    return (
      <div className="min-h-screen bg-background text-[var(--foreground)] flex items-center justify-center px-6">
        <div className="w-full max-w-2xl rounded-[2rem] border border-[var(--border)] bg-[var(--surface)]/90 p-8 shadow-2xl backdrop-blur">
          <h1 className="text-4xl font-semibold tracking-tight">
            {bootState === 'completed' ? 'Setup Completed' : 'Setup Is Locked'}
          </h1>
          <div className="mt-6 space-y-4 text-lg leading-8 text-muted">
            {bootState === 'completed' ? (
              <>
                <p>The installer has already completed once and is now permanently disabled.</p>
                <p>Stop this session and run the normal app with:</p>
                <pre className="overflow-x-auto rounded-xl border border-[var(--border)] bg-black/30 p-4 text-sm text-slate-100">
                  <code>./start-local.sh</code>
                </pre>
              </>
            ) : (
              <>
                <p>This setup app only opens during an explicit one-time setup run.</p>
                <p>Start a setup session with:</p>
                <pre className="overflow-x-auto rounded-xl border border-[var(--border)] bg-black/30 p-4 text-sm text-slate-100">
                  <code>./start-local.sh --setup</code>
                </pre>
              </>
            )}
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
