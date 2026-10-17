import { captureExecutionDefinition } from './execution-definition';
import {
  type ReleaseCandidate,
  ReleaseValidationError,
} from './release-contract';
import {
  RELEASE_ENVIRONMENT_NODE_ID,
  releaseSecretVersions,
} from './release-policy';
import { hydrateLinkedWorkflowEnvironments } from './workflow-environments';
import {
  getEnvironmentSecretKeys,
  hydrateEnvironmentSecretVariables,
} from './environment-secrets';
import { prisma } from '../lib/prisma';

async function loadReleaseSecrets(keys: string[], userId: string) {
  return prisma.environmentSecret.findMany({
    where: { userId, key: { in: keys } },
    select: { key: true, id: true, updatedAt: true, value: true },
  });
}

function injectReleaseEnvironment(nodes: any[], candidate: ReleaseCandidate) {
  const values = {
    BASE_URL: candidate.targetUrl,
    RELEASE_REPOSITORY: candidate.repository,
    RELEASE_COMMIT_SHA: candidate.commitSha,
    RELEASE_ARTIFACT_DIGEST: candidate.artifactDigest,
    RELEASE_ENVIRONMENT: candidate.environment,
    RELEASE_TARGET_URL: candidate.targetUrl,
  };
  const keys = Object.keys(values);
  const prepared = nodes.map((node) => {
    if (node?.nodeType !== 'playwright') return node;
    const config = node.config ?? {};
    return {
      ...node,
      config: {
        ...config,
        envVars: [
          ...new Set([
            ...(Array.isArray(config.envVars) ? config.envVars : []),
            ...keys,
          ]),
        ],
      },
    };
  });
  // The orchestrator merges environment nodes in definition order. Append the
  // server-owned values last so saved variables cannot redirect release checks.
  prepared.push({
    id: RELEASE_ENVIRONMENT_NODE_ID,
    nodeType: 'environment',
    label: 'Release candidate',
    config: {
      variables: Object.entries(values).map(([key, value]) => ({
        key,
        type: 'default',
        enabled: true,
        initialValue: value,
        currentValue: value,
      })),
    },
  });
  return prepared;
}

export async function prepareReleaseExecution(
  body: Record<string, any>,
  userId: string,
  hydrate = hydrateLinkedWorkflowEnvironments,
  loadSecrets = loadReleaseSecrets,
) {
  // Use this exact hydrated copy for both the policy snapshot and execution.
  // Hydrating a second time could change linked values after policy validation.
  const nodes = await hydrate(body.nodes, userId);
  const keys = getEnvironmentSecretKeys(nodes);
  const secrets = keys.length ? await loadSecrets(keys, userId) : [];
  const hydratedBody = { ...body, nodes };
  let definition;
  try {
    definition = captureExecutionDefinition(
      hydratedBody,
      releaseSecretVersions(nodes, secrets),
    );
    if (!definition.release)
      throw new ReleaseValidationError('A release request is required.');
  } catch (error) {
    throw Object.assign(error as Error, { statusCode: 400 });
  }
  // Hydrate from the same records whose revisions were pinned above. A later
  // secret edit cannot change this run after the policy has been checked.
  const executionNodes = hydrateEnvironmentSecretVariables(
    nodes,
    new Map(secrets.map((secret) => [secret.key, secret.value])),
  );
  return {
    definition,
    body: {
      ...hydratedBody,
      nodes: injectReleaseEnvironment(
        Array.isArray(executionNodes) ? executionNodes : [],
        definition.release.candidate,
      ),
    },
  };
}
