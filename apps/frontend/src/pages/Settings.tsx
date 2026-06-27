import { Input, Button } from '../components/ui';

export default function Settings() {
  return (
    <main className="flex-1 p-8 max-w-4xl mx-auto w-full space-y-8">
      <div className="bg-surface border border-subtle rounded-2xl overflow-hidden shadow-sm">
        <div className="p-6 border-b border-subtle">
          <h2 className="text-lg font-medium text-[var(--foreground)] mb-1">
            Profile
          </h2>
          <p className="text-sm text-muted">
            Manage your personal information and preferences.
          </p>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <label className="text-sm font-medium text-muted md:pt-2">
              Name
            </label>
            <div className="md:col-span-3">
              <Input defaultValue="A. J. Barry" className="max-w-md" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <label className="text-sm font-medium text-muted md:pt-2">
              Email address
            </label>
            <div className="md:col-span-3">
              <Input
                defaultValue="ajbarry99@gmail.com"
                disabled
                className="max-w-md"
              />
              <p className="mt-2 text-xs text-muted">
                Your email is managed by your authentication provider.
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-subtle bg-surface-hover/50 flex justify-end">
          <Button variant="primary">Save Changes</Button>
        </div>
      </div>
    </main>
  );
}
