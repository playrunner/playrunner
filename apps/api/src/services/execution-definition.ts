import {
  validateTestPlan,
  type TestPlan,
} from '../../../runners/shared/test-plan';
import { AsyncLocalStorage } from 'node:async_hooks';

export type ExecutionDefinition = {
  title: string;
  testPlan?: TestPlan;
  nodes: Array<{
    id: string;
    title: string;
    type: string;
    suiteId?: string;
    testPlan?: TestPlan;
  }>;
};

export const executionDefinitionContext =
  new AsyncLocalStorage<ExecutionDefinition>();

// Capture display metadata before credentials and environment values are hydrated.
export function captureExecutionDefinition(
  body: Record<string, any>,
): ExecutionDefinition {
  return {
    title: String(body.workflow?.definition?.name || 'Workflow'),
    ...(body.workflow?.definition?.testPlan
      ? { testPlan: validateTestPlan(body.workflow.definition.testPlan) }
      : {}),
    nodes: (Array.isArray(body.nodes) ? body.nodes : []).map((node: any) => ({
      id: String(node.id),
      title: String(node.title || node.label || node.nodeType || node.id),
      type: String(node.nodeType || ''),
      ...(node.config?.testSuite?.id
        ? { suiteId: String(node.config.testSuite.id) }
        : {}),
      ...(node.config?.testPlan
        ? { testPlan: validateTestPlan(node.config.testPlan) }
        : {}),
    })),
  };
}
