type SavedWorkflow = {
  cloudProvider: string | null;
  concurrency: number | null;
  connections: unknown;
  id: string;
  nodes: unknown;
  title: string | null;
};

export function buildSavedWorkflowExecutionBody(params: {
  body?: Record<string, unknown>;
  executionId: string;
  triggerData: Record<string, unknown>;
  triggerName: 'ci' | 'schedule' | 'webhook';
  workflow: SavedWorkflow;
}) {
  const cloudProvider = params.workflow.cloudProvider || 'LOCAL_RUNNER';
  return {
    ...params.body,
    cloudProvider,
    concurrency: params.workflow.concurrency ?? undefined,
    connections: params.workflow.connections ?? [],
    nodes: params.workflow.nodes ?? [],
    testId: params.executionId,
    trigger: params.triggerData,
    workflowId: params.workflow.id,
    workflow: {
      definition: {
        id: params.workflow.id,
        name: params.workflow.title || 'Untitled Workflow',
      },
      run: { runner: cloudProvider, trigger: params.triggerName },
      trigger: params.triggerData,
    },
  };
}
