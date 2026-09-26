import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertCircle, Download, FileText } from 'lucide-react';
import { Badge, Button } from '../components/ui';
import { auth } from '../lib/auth';
import { openAuthenticatedOutput } from '../lib/output-links';
import type { WorkflowTestPlan } from '../components/WorkflowTestPlanPanel';

type Report = {
  plan: WorkflowTestPlan;
  title: string;
  status: string;
  executionStatus: string;
  version: string;
  counts: Record<string, number>;
  cases: Array<
    WorkflowTestPlan['cases'][number] & {
      status: string;
      reason: string;
      evidence: Array<{
        title: string;
        project: string;
        nodeId: string;
        status: string;
      }>;
    }
  >;
  nodes: Array<{
    id: string;
    title: string;
    status: string;
    reportUrl: string | null;
  }>;
};

export default function WorkflowTestPlanReport() {
  const { executionId } = useParams();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        const response = await fetch(
          '/api/executions/' + encodeURIComponent(executionId!) + '/test-plan',
          {
            headers: { Authorization: 'Bearer ' + token },
          },
        );
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || 'Could not load report.');
        if (closed) return;
        setReport(result);
        setError('');
        if (result.executionStatus === 'running')
          timer = setTimeout(load, 2000);
      } catch (cause) {
        if (!closed)
          setError(
            cause instanceof Error ? cause.message : 'Could not load report.',
          );
      }
    };
    void load();
    return () => {
      closed = true;
      clearTimeout(timer);
    };
  }, [executionId]);
  const download = (name: string, content: string, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="max-w-7xl mx-auto p-6 md:p-8 w-full space-y-6">
      <Link className="text-sm underline" to="/executions">
        Live executions
      </Link>
      {error && (
        <p role="alert" className="flex gap-2 text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </p>
      )}
      {!report && !error && <p role="status">Loading test plan report…</p>}
      {report && (
        <>
          <header className="space-y-2 border-b border-subtle pb-6">
            <h1 className="text-3xl font-semibold">
              Test plan: {report.plan.name}
            </h1>
            <h2 className="text-xl font-medium">
              Overall plan: {report.status}
            </h2>
            <p className="text-sm text-muted">
              {report.title} · Workflow {report.executionStatus} · {executionId}
            </p>
            <p className="text-xs text-muted break-all">
              Plan version: {report.version}
            </p>
            <p className="text-sm">
              {Object.entries(report.counts)
                .map(([key, count]) => key + ': ' + count)
                .join(' · ')}
            </p>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  download(
                    report.plan.name,
                    report.plan.markdown,
                    'text/markdown',
                  )
                }
              >
                <Download className="w-4 h-4" />
                Download original plan
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  download(
                    'test-plan-results.json',
                    JSON.stringify(report, null, 2),
                    'application/json',
                  )
                }
              >
                <Download className="w-4 h-4" />
                Download plan results
              </Button>
            </div>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left border border-subtle">
              <thead>
                <tr>
                  {[
                    'Case',
                    'SUCCESS/PASS criteria',
                    'Outcome and evidence',
                  ].map((title) => (
                    <th key={title} className="p-3 border border-subtle">
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.cases.map((item) => (
                  <tr key={item.id}>
                    <td className="p-3 border border-subtle align-top">
                      {item.id}
                      <p className="text-muted whitespace-pre-wrap">
                        {item.description}
                      </p>
                    </td>
                    <td className="p-3 border border-subtle align-top whitespace-pre-wrap">
                      {item.criteria}
                    </td>
                    <td className="p-3 border border-subtle align-top">
                      <Badge
                        variant={
                          item.status === 'PASS'
                            ? 'success'
                            : item.status === 'FAIL'
                              ? 'danger'
                              : 'outline'
                        }
                      >
                        {item.status}
                      </Badge>
                      <p className="text-muted my-2">{item.reason}</p>
                      {item.evidence.map((evidence, index) => (
                        <p key={index} className="text-xs">
                          {report.nodes.find(
                            (node) => node.id === evidence.nodeId,
                          )?.title ?? evidence.nodeId}{' '}
                          · {evidence.project} · {evidence.title}:{' '}
                          {evidence.status}
                        </p>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section className="space-y-3">
            <h2 className="text-xl font-medium">Workflow node reports</h2>
            {report.nodes.map((node) => (
              <div key={node.id} className="flex items-center gap-3">
                <span>
                  {node.title} · {node.status}
                </span>
                {node.reportUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void openAuthenticatedOutput(node.reportUrl!)
                    }
                  >
                    <FileText className="w-4 h-4" />
                    Report
                  </Button>
                )}
              </div>
            ))}
          </section>
          <section className="space-y-3">
            <h2 className="text-xl font-medium">Original test plan</h2>
            <p className="text-sm text-muted">
              Authored status text is preserved; it does not override the
              execution results above.
            </p>
            <pre className="whitespace-pre-wrap break-words p-4 bg-surface border border-subtle rounded-xl text-xs">
              {report.plan.markdown}
            </pre>
          </section>
        </>
      )}
    </div>
  );
}
