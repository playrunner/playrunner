import { createHash } from 'node:crypto';
import { validateTestPlan } from '../../../runners/shared/test-plan';
import {
  RELEASE_IDENTITY_CASE,
  ReleaseValidationError,
} from './release-contract';
import { hydrateLinkedWorkflowEnvironments } from './workflow-environments';
import { getEnvironmentSecretKeys } from './environment-secrets';
import { prisma } from '../lib/prisma';

export const RELEASE_ENVIRONMENT_NODE_ID = '__playrunner_release_environment';
const RELEASE_NODE_TYPES = new Set([
  'environment',
  'playwright',
  'code',
  'javascript',
  'webhooks',
]);

export type ReleaseSecretVersion = {
  key: string;
  id: string;
  updatedAt: string;
};

type SecretRevisionRecord = {
  key: string;
  id: string;
  updatedAt: Date;
};

export function releaseSecretVersions(
  nodes: unknown,
  records: SecretRevisionRecord[],
): ReleaseSecretVersion[] {
  return getEnvironmentSecretKeys(nodes)
    .sort()
    .map((key) => {
      const matches = records.filter((record) => record.key === key);
      if (matches.length !== 1)
        throw new ReleaseValidationError(
          'A required release environment secret is unavailable.',
        );
      const record = matches[0];
      return { key, id: record.id, updatedAt: record.updatedAt.toISOString() };
    });
}

async function loadSecretVersions(keys: string[], userId: string) {
  return prisma.environmentSecret.findMany({
    where: { userId, key: { in: keys } },
    select: { key: true, id: true, updatedAt: true },
  });
}

export type ReleaseWorkflow = {
  testPlan?: unknown;
  nodes: unknown;
  connections: unknown;
  cloudProvider?: string | null;
  concurrency?: number | null;
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

export function buildReleasePolicy(
  workflow: ReleaseWorkflow,
  secretVersions: ReleaseSecretVersion[] = [],
) {
  let plan;
  try {
    plan = validateTestPlan(workflow.testPlan);
  } catch {
    throw new ReleaseValidationError(
      'A saved test plan is required for release verification.',
    );
  }
  const identity = plan.cases.find((item) => item.id === RELEASE_IDENTITY_CASE);
  if (
    !identity ||
    identity.nodes?.length !== 1 ||
    identity.tests.length ||
    !identity.criteria.trim()
  )
    throw new ReleaseValidationError(
      'The test plan must contain RELEASE_IDENTITY with exactly one required identity node and no test mappings.',
    );
  if (
    plan.cases.length < 2 ||
    plan.cases.some(
      (item) =>
        !item.criteria.trim() || (!item.tests.length && !item.nodes?.length),
    )
  )
    throw new ReleaseValidationError(
      'Release verification requires executable requirements in addition to RELEASE_IDENTITY.',
    );
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  const pinnedSecrets = getEnvironmentSecretKeys(nodes)
    .sort()
    .map((key) => {
      const matches = secretVersions.filter((version) => version.key === key);
      if (matches.length !== 1)
        throw new ReleaseValidationError(
          'Release environment secret revisions must be resolved before policy validation.',
        );
      const { id, updatedAt } = matches[0];
      return { key, id, updatedAt };
    });
  const policyNodes = nodes.map((node) => {
    if (!Array.isArray(node?.config?.variables)) return node;
    return {
      ...node,
      config: {
        ...node.config,
        variables: node.config.variables.map(
          (variable: Record<string, unknown>) => {
            if (variable?.type !== 'secret') return variable;
            const {
              currentValue: _current,
              initialValue: _initial,
              value: _value,
              ...reference
            } = variable;
            return reference;
          },
        ),
      },
    };
  });
  const nodeIds = new Set(nodes.map((node: { id?: unknown }) => node?.id));
  if (nodeIds.has(RELEASE_ENVIRONMENT_NODE_ID))
    throw new ReleaseValidationError(
      'The release environment node ID is reserved for server use.',
    );
  for (const node of nodes) {
    if (!RELEASE_NODE_TYPES.has(node?.nodeType))
      throw new ReleaseValidationError(
        'Release verification currently supports only Environment, Playwright, JavaScript and Webhook nodes. AI generation, memory and other integrations cannot be pinned as release checks.',
      );
    if (node?.nodeType !== 'playwright') continue;
    const config = node.config ?? {};
    if (config.action === 'workspace')
      throw new ReleaseValidationError(
        'Release checks cannot use a mutable local test workspace. Use an uploaded suite, inline script, or a pinned Git commit.',
      );
    if (
      (config.action === 'clone' || (!config.action && config.repository)) &&
      (typeof config.branch !== 'string' ||
        !/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(config.branch))
    )
      throw new ReleaseValidationError(
        'Release check repositories must be pinned to a full Git commit SHA in branch.',
      );
  }
  if (
    !nodeIds.has(identity.nodes[0]) ||
    plan.cases.some(
      (item) =>
        item.nodes?.some((id) => !nodeIds.has(id)) ||
        item.tests.some((test) => !test.nodeId || !nodeIds.has(test.nodeId)),
    )
  )
    throw new ReleaseValidationError(
      'Release requirements must map explicitly to saved workflow nodes.',
    );
  return {
    policyVersion: createHash('sha256')
      .update(
        JSON.stringify(
          canonical({
            testPlan: plan,
            nodes: policyNodes,
            connections: workflow.connections ?? [],
            cloudProvider: workflow.cloudProvider || 'LOCAL_RUNNER',
            concurrency: workflow.concurrency ?? null,
            secretVersions: pinnedSecrets,
          }),
        ),
      )
      .digest('hex'),
    criteriaVersion: createHash('sha256')
      .update(JSON.stringify(plan))
      .digest('hex'),
    identityCaseId: RELEASE_IDENTITY_CASE,
    identityNodeId: identity.nodes[0],
    requirements: plan.cases.map((item) => ({ id: item.id })),
  };
}

// Resolve linked values before hashing, but never hydrate credentials or return
// environment contents to callers of the policy endpoint.
export async function resolveReleasePolicy(
  workflow: ReleaseWorkflow,
  userId: string,
  hydrate = hydrateLinkedWorkflowEnvironments,
  loadSecrets = loadSecretVersions,
) {
  const nodes = await hydrate(workflow.nodes, userId);
  const keys = getEnvironmentSecretKeys(nodes);
  const records = keys.length ? await loadSecrets(keys, userId) : [];
  return buildReleasePolicy(
    { ...workflow, nodes },
    releaseSecretVersions(nodes, records),
  );
}
