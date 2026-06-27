import { Users } from 'lucide-react';
import { Badge } from '../components/ui/Badge';

export default function Teams() {
  return (
    <main className="flex-1 max-w-6xl mx-auto p-8 w-full">
      <div className="mb-8 border-b border-subtle pb-6">
        <h2 className="text-3xl font-semibold tracking-tight text-[var(--foreground)]">
          Teams
        </h2>
        <p className="text-sm text-muted mt-2 leading-relaxed">
          Workspace collaboration and role-based access controls.
        </p>
      </div>

      <section className="bg-surface border border-subtle rounded-xl shadow-sm p-8">
        <div className="max-w-xl">
          <div className="h-9 w-9 rounded-lg bg-surface-hover border border-subtle flex items-center justify-center text-muted mb-5">
            <Users className="h-4 w-4" />
          </div>
          <Badge variant="outline" className="uppercase tracking-wide">
            COMING SOON
          </Badge>
          <h3 className="text-xl font-medium text-[var(--foreground)] mt-4">
            Team management is coming soon
          </h3>
          <p className="text-sm text-muted leading-relaxed mt-2">
            This page will support inviting collaborators, assigning roles, and
            managing workspace access when team features are available.
          </p>
        </div>
      </section>
    </main>
  );
}
