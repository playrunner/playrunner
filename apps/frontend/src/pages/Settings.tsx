import { Link } from 'react-router-dom';
import { KeyRound, Mail, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { auth } from '../lib/auth';

function getDisplayName(user: typeof auth.currentUser) {
  return (
    user?.name?.trim() || user?.email?.split('@')[0] || user?.username || ''
  );
}

export default function Settings() {
  const [currentUser, setCurrentUser] = useState(auth.currentUser);

  useEffect(() => {
    return auth.onAuthStateChanged((user) => {
      setCurrentUser(user);
    });
  }, []);

  const email = currentUser?.email ?? '';
  const username = currentUser?.username ?? '';
  const displayName = getDisplayName(currentUser);

  return (
    <main className="flex-1 p-8 max-w-7xl mx-auto w-full space-y-8">
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
              <User className="h-4 w-4" />
              Name
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
              <Mail className="h-4 w-4" />
              Email address
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
    </main>
  );
}
