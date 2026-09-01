type SavedWorkflow = {
  cloudProvider: string | null;
  concurrency: number | null;
  connections: unknown;
  id: string;
  nodes: unknown;
  title: string | null;
};

export function buildSavedWorkflowExecutionBody(params: {
  agentMemoryByNodeId?: Record<string, unknown>;
  body?: Record<string, unknown>;
  executionId: string;
  triggerData: Record<string, unknown>;
  triggerName: 'ci' | 'cli' | 'schedule' | 'webhook';
  workflow: SavedWorkflow;
}) {
  const cloudProvider = params.workflow.cloudProvider || 'LOCAL_RUNNER';
  const trustedBody = Object.fromEntries(
    Object.entries(params.body ?? {}).filter(
      ([key]) =>
        key !== 'agentMemoryByNodeId' &&
        key !== 'authenticationStatesByNodeId' &&
        key !== 'authenticationProfileNodeIds' &&
        (key !== 'ci' || params.triggerName === 'ci'),
    ),
  );
  return {
    ...trustedBody,
    ...(params.agentMemoryByNodeId
      ? { agentMemoryByNodeId: params.agentMemoryByNodeId }
      : {}),
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
