import crypto from 'node:crypto';

type JsonRecord = Record<string, unknown>;

export const MAX_WORKFLOW_DEFINITION_BYTES = 2 * 1024 * 1024;

export type WorkflowDefinition = {
  project: { key: string; title: string };
  workflow: {
    cloudProvider: string;
    concurrency?: number;
    connections: JsonRecord[];
    key: string;
    nodes: JsonRecord[];
    title: string;
  };
};

export class WorkflowDefinitionValidationError extends Error {}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function requiredString(value: unknown, field: string, maximum: number) {
  const parsed = typeof value === 'string' ? value.trim() : '';
  if (!parsed || parsed.length > maximum || parsed.includes('\0')) {
    throw new WorkflowDefinitionValidationError(
      `${field} must be between 1 and ${maximum} characters.`,
    );
  }
  return parsed;
}

function definitionKey(value: unknown, field: string) {
  const parsed = requiredString(value, field, 100);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(parsed)) {
    throw new WorkflowDefinitionValidationError(
      `${field} may contain only letters, numbers, dots, underscores, and hyphens.`,
    );
  }
  return parsed;
}

function objectArray(value: unknown, field: string, maximum: number) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new WorkflowDefinitionValidationError(
      `${field} must be an array with at most ${maximum} entries.`,
    );
  }
  return value.map((item, index) => {
    const parsed = record(item);
    if (!parsed) {
      throw new WorkflowDefinitionValidationError(
        `${field}[${index}] must be an object.`,
      );
    }
    return parsed;
  });
}

function rejectEmbeddedSecrets(nodes: JsonRecord[]) {
  for (const node of nodes) {
    if (node.nodeType !== 'environment') continue;
    const config = record(node.config);
    const variables = Array.isArray(config?.variables) ? config.variables : [];
    for (const variable of variables) {
      const candidate = record(variable);
      if (
        candidate?.type === 'secret' &&
        [candidate.initialValue, candidate.currentValue].some(
          (value) => typeof value === 'string' && value.length > 0,
        )
      ) {
        throw new WorkflowDefinitionValidationError(
          'Workflow definition files must not contain secret values.',
        );
      }
    }
  }
}

export function parseWorkflowDefinition(value: unknown): WorkflowDefinition {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string') {
    throw new WorkflowDefinitionValidationError(
      'The workflow definition must be a JSON object.',
    );
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_WORKFLOW_DEFINITION_BYTES) {
    throw new WorkflowDefinitionValidationError(
      'The workflow definition must be at most 2 MiB.',
    );
  }
  const root = record(value);
  const project = record(root?.project);
  const workflow = record(root?.workflow);
  if (!project || !workflow) {
    throw new WorkflowDefinitionValidationError(
      'The definition must contain project and workflow objects.',
    );
  }

  const nodes = objectArray(workflow.nodes, 'workflow.nodes', 500);
  const connections = objectArray(
    workflow.connections,
    'workflow.connections',
    1_000,
  );
  const nodeIds = new Set<string>();
  nodes.forEach((node, index) => {
    const id = requiredString(node.id, `workflow.nodes[${index}].id`, 100);
    requiredString(node.nodeType, `workflow.nodes[${index}].nodeType`, 100);
    if (nodeIds.has(id)) {
      throw new WorkflowDefinitionValidationError(`Duplicate node id: ${id}.`);
    }
    if (node.nodeType === 'schedule') {
      throw new WorkflowDefinitionValidationError(
        'Schedule nodes cannot currently be provisioned by an API token.',
      );
    }
    nodeIds.add(id);
  });
  connections.forEach((connection, index) => {
    const sourceId = requiredString(
      connection.sourceId,
      `workflow.connections[${index}].sourceId`,
      100,
    );
    const targetId = requiredString(
      connection.targetId,
      `workflow.connections[${index}].targetId`,
      100,
    );
    if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) {
      throw new WorkflowDefinitionValidationError(
        `workflow.connections[${index}] references an unknown node.`,
      );
    }
  });
  rejectEmbeddedSecrets(nodes);

  const concurrency =
    workflow.concurrency === undefined
      ? undefined
      : Number(workflow.concurrency);
  if (
    concurrency !== undefined &&
    (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 100)
  ) {
    throw new WorkflowDefinitionValidationError(
      'workflow.concurrency must be an integer between 1 and 100.',
    );
  }

  return {
    project: {
      key: definitionKey(project.key, 'project.key'),
      title: requiredString(project.title, 'project.title', 200),
    },
    workflow: {
      cloudProvider:
        typeof workflow.cloudProvider === 'string' &&
        workflow.cloudProvider.trim()
          ? workflow.cloudProvider.trim()
          : 'LOCAL_RUNNER',
      ...(concurrency === undefined ? {} : { concurrency }),
      connections,
      key: definitionKey(workflow.key, 'workflow.key'),
      nodes,
      title: requiredString(workflow.title, 'workflow.title', 200),
    },
  };
}

function ownedId(kind: 'project' | 'workflow', userId: string, key: string) {
  const digest = crypto
    .createHash('sha256')
    .update(`${kind}\0${userId}\0${key}`)
    .digest('hex')
    .slice(0, 32);
  return `cli-${kind}-${digest}`;
}

export function workflowDefinitionIds(
  userId: string,
  definition: WorkflowDefinition,
) {
  return {
    projectId: ownedId('project', userId, definition.project.key),
    workflowId: ownedId(
      'workflow',
      userId,
      `${definition.project.key}\0${definition.workflow.key}`,
    ),
  };
}
