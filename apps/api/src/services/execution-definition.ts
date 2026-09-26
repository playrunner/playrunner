import { AsyncLocalStorage } from 'node:async_hooks';

export type ExecutionDefinition = {
  title: string;
  nodes: Array<{ id: string; title: string; type: string }>;
};

export const executionDefinitionContext =
  new AsyncLocalStorage<ExecutionDefinition>();

// Capture display metadata before credentials and environment values are hydrated.
export function captureExecutionDefinition(
  body: Record<string, any>,
): ExecutionDefinition {
  return {
    title: String(body.workflow?.definition?.name || 'Workflow'),
    nodes: (Array.isArray(body.nodes) ? body.nodes : []).map((node: any) => ({
      id: String(node.id),
      title: String(node.title || node.label || node.nodeType || node.id),
      type: String(node.nodeType || ''),
    })),
  };
}
