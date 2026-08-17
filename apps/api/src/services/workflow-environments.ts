import { Prisma } from '../generated/prisma/client.cts';
import { prisma } from '../lib/prisma';

type WorkflowNode = {
  config?: Record<string, unknown>;
  nodeType?: unknown;
  [key: string]: unknown;
};

export function getLinkedEnvironmentIds(nodes: unknown) {
  if (!Array.isArray(nodes)) return [];
  return [
    ...new Set(
      nodes.flatMap((node) => {
        if (!node || typeof node !== 'object') return [];
        const candidate = node as WorkflowNode;
        const environmentId = candidate.config?.environmentId;
        return candidate.nodeType === 'environment' &&
          typeof environmentId === 'string' &&
          environmentId
          ? [environmentId]
          : [];
      }),
    ),
  ];
}

export function applyLinkedWorkflowEnvironments(
  nodes: unknown,
  environments: ReadonlyMap<string, Prisma.JsonValue>,
) {
  if (!Array.isArray(nodes)) return nodes;
  return nodes.map((node) => {
    if (!node || typeof node !== 'object') return node;
    const candidate = node as WorkflowNode;
    const environmentId = candidate.config?.environmentId;
    const variables =
      typeof environmentId === 'string'
        ? environments.get(environmentId)
        : undefined;
    if (variables === undefined) return node;
    return {
      ...candidate,
      config: {
        ...candidate.config,
        variables,
      },
    };
  });
}

export async function hydrateLinkedWorkflowEnvironments(
  nodes: unknown,
  ownerUserId: string,
) {
  const environmentIds = getLinkedEnvironmentIds(nodes);
  if (environmentIds.length === 0) return nodes;

  const environments = await prisma.environment.findMany({
    where: { id: { in: environmentIds }, userId: ownerUserId },
    select: { id: true, variables: true },
  });
  const byId = new Map(
    environments.map((environment) => [environment.id, environment.variables]),
  );
  const missingId = environmentIds.find((id) => !byId.has(id));
  if (missingId) {
    throw Object.assign(
      new Error(
        `The linked global environment ${missingId} is unavailable. Ask the workflow owner to relink it.`,
      ),
      { code: 'workflow_environment_unavailable', statusCode: 409 },
    );
  }

  return applyLinkedWorkflowEnvironments(nodes, byId);
}
