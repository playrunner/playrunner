import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2, LockKeyhole, UserRound } from 'lucide-react';
import { Button, Input } from '../components/ui';
import { auth, signInWithPassword } from '../lib/auth';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (auth.currentUser) {
      navigate('/projects', { replace: true });
    }
  }, [navigate]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      await signInWithPassword(username.trim(), password);
      localStorage.removeItem('hasCompletedOnboarding');
      navigate('/projects', { replace: true });
    } catch (loginError) {
      setError(
        loginError instanceof Error ? loginError.message : 'Login failed.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none flex items-center justify-center">
        <div className="w-[800px] h-[600px] bg-[var(--border)] opacity-20 blur-[120px] rounded-full mix-blend-screen" />
      </div>

      <div className="w-full max-w-sm z-10">
        <div className="text-center mb-10">
          <div className="flex flex-col items-center justify-center gap-3 mb-4">
            <img
              src="/images/playrunner-icon.svg"
              alt="Playrunner"
              className="h-14 w-14 object-contain"
            />
            <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)]">
              Playrunner
            </h1>
          </div>
          <p className="text-sm text-muted">
            No-code test orchestration and cloud runner
            <br />
            for modern engineering teams.
          </p>
        </div>

        <div className="bg-surface border border-subtle rounded-2xl p-8 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-[var(--border-strong)] to-transparent" />

          <h2 className="text-xl font-semibold text-[var(--foreground)] mb-2">
            Log in with the local account from setup
          </h2>
          <p className="text-sm text-muted mb-6">
            Use the username and password configured during local setup.
          </p>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <Input
              icon={<UserRound className="w-4 h-4" />}
              placeholder="Username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              disabled={isLoading}
            />

            <Input
              type="password"
              icon={<LockKeyhole className="w-4 h-4" />}
              placeholder="Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              disabled={isLoading}
            />

            {error ? <p className="text-sm text-red-400">{error}</p> : null}

            <Button
              type="submit"
              variant="primary"
              className="w-full gap-2"
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4" />
              )}
              {isLoading ? 'Signing in...' : 'Enter Playrunner'}
            </Button>
          </form>

          <div className="mt-6 rounded-xl border border-subtle bg-[var(--background)]/70 px-4 py-3">
            <p className="text-xs text-muted">
              If local auth has not been configured yet, run{' '}
              <code>./start-local.sh</code> and finish the setup wizard.
            </p>
          </div>
        </div>

        <div className="mt-12 flex items-center justify-center gap-1.5 opacity-50">
          <span className="text-xs text-muted">Powered by</span>
          <span className="text-xs font-semibold tracking-wider uppercase text-muted">
            Playrunner
          </span>
        </div>
      </div>
    </div>
  );
}
