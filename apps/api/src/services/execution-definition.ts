import {
  validateTestPlan,
  type TestPlan,
} from '../../../runners/shared/test-plan';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  parseReleaseRequest,
  ReleaseValidationError,
  type ReleaseRequest,
} from './release-contract';
import {
  buildReleasePolicy,
  type ReleaseSecretVersion,
} from './release-policy';

export type ExecutionDefinition = {
  title: string;
  testPlan?: TestPlan;
  release?: ReleaseRequest & {
    criteriaVersion: string;
    identityNodeId: string;
  };
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
  secretVersions: ReleaseSecretVersion[] = [],
): ExecutionDefinition {
  let release: ExecutionDefinition['release'];
  if (body.release !== undefined) {
    const requested = parseReleaseRequest(body.release);
    const policy = buildReleasePolicy(
      {
        testPlan: body.workflow?.definition?.testPlan,
        nodes: body.nodes,
        connections: body.connections,
        cloudProvider: body.cloudProvider,
        concurrency: body.concurrency,
      },
      secretVersions,
    );
    if (requested.policyVersion !== policy.policyVersion)
      throw new ReleaseValidationError(
        'The saved release policy has changed. Review and pin its current version before running.',
      );
    release = {
      ...requested,
      criteriaVersion: policy.criteriaVersion,
      identityNodeId: policy.identityNodeId,
    };
  }
  return {
    ...(release ? { release } : {}),
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
