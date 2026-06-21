export default function Analytics() {
  return (
    <main className="flex-1 overflow-y-auto max-w-6xl mx-auto p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold tracking-tight">
          Analytics Dashboard
        </h2>
        <p className="text-muted mt-1">
          Monitor workflow execution times, success rates, and errors.
        </p>
      </div>

      <div className="bg-surface border border-subtle rounded-xl p-8 text-center text-muted">
        <p>Analytics metrics will appear here.</p>
      </div>
    </main>
  );
}
