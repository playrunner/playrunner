import { Plus } from 'lucide-react';
import { Button } from '../components/ui/Button';

export default function Teams() {
  return (
    <main className="flex-1 overflow-y-auto max-w-6xl mx-auto p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Teams</h2>
          <p className="text-muted mt-1">
            Manage team members and role-based access control.
          </p>
        </div>
        <Button variant="primary">
          <Plus className="w-4 h-4 mr-2" />
          Invite Member
        </Button>
      </div>

      <div className="bg-surface border border-subtle rounded-xl p-8 text-center text-muted">
        <p>You haven't added any team members yet.</p>
      </div>
    </main>
  );
}
