import {
  ORCHESTRATOR_CONTRACT_VERSION,
  type OrchestratorIntegrationContribution,
  type OrchestratorIntegrationExecutor,
} from '@playrunner/integration-sdk/orchestrator';

export interface OrchestratorExecutorDiagnostic {
  nodeType: string;
  action?: string;
  default: boolean;
}

export interface OrchestratorContributionDiagnostic {
  id: string;
  contractVersion: number;
  executors: readonly OrchestratorExecutorDiagnostic[];
}

export interface ResolvedOrchestratorExecutor {
  contributionId: string;
  executor: OrchestratorIntegrationExecutor;
}

export interface OrchestratorRegistry {
  contributions: readonly OrchestratorIntegrationContribution[];
  diagnostics: readonly OrchestratorContributionDiagnostic[];
  resolve: (
    nodeType: string,
    action?: string,
  ) => ResolvedOrchestratorExecutor | undefined;
}

export class OrchestratorRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrchestratorRegistryError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertContribution(
  value: unknown,
  index: number,
): asserts value is OrchestratorIntegrationContribution {
  if (!isRecord(value)) {
    throw new OrchestratorRegistryError(
      `Malformed orchestrator contribution at index ${index}: expected an object.`,
    );
  }

  const id = isNonEmptyString(value.id)
    ? value.id
    : `contribution at index ${index}`;

  if (!isNonEmptyString(value.id)) {
    throw new OrchestratorRegistryError(
      `Malformed orchestrator contribution at index ${index}: id must be a non-empty string.`,
    );
  }

  if (typeof value.contractVersion !== 'number') {
    throw new OrchestratorRegistryError(
      `Malformed orchestrator contribution "${id}": contractVersion must be a number.`,
    );
  }

  if (value.contractVersion !== ORCHESTRATOR_CONTRACT_VERSION) {
    throw new OrchestratorRegistryError(
      `Unsupported orchestrator contract version for "${id}": expected ${ORCHESTRATOR_CONTRACT_VERSION}, received ${value.contractVersion}.`,
    );
  }

  if (!Array.isArray(value.executors) || value.executors.length === 0) {
    throw new OrchestratorRegistryError(
      `Malformed orchestrator contribution "${id}": executors must be a non-empty array.`,
    );
  }

  value.executors.forEach((executor, executorIndex) => {
    if (!isRecord(executor)) {
      throw new OrchestratorRegistryError(
        `Malformed executor ${executorIndex} in orchestrator contribution "${id}": expected an object.`,
      );
    }

    if (!isNonEmptyString(executor.nodeType)) {
      throw new OrchestratorRegistryError(
        `Malformed executor ${executorIndex} in orchestrator contribution "${id}": nodeType must be a non-empty string.`,
      );
    }

    if (executor.action !== undefined && !isNonEmptyString(executor.action)) {
      throw new OrchestratorRegistryError(
        `Malformed executor ${executorIndex} in orchestrator contribution "${id}": action must be a non-empty string when provided.`,
      );
    }

    if (
      executor.default !== undefined &&
      typeof executor.default !== 'boolean'
    ) {
      throw new OrchestratorRegistryError(
        `Malformed executor ${executorIndex} in orchestrator contribution "${id}": default must be a boolean when provided.`,
      );
    }

    if (
      executor.validate !== undefined &&
      typeof executor.validate !== 'function'
    ) {
      throw new OrchestratorRegistryError(
        `Malformed executor ${executorIndex} in orchestrator contribution "${id}": validate must be a function when provided.`,
      );
    }

    if (typeof executor.execute !== 'function') {
      throw new OrchestratorRegistryError(
        `Malformed executor ${executorIndex} in orchestrator contribution "${id}": execute must be a function.`,
      );
    }
  });
}

function executorDescription(
  nodeType: string,
  action: string | undefined,
): string {
  return action === undefined
    ? `node type "${nodeType}" without an action`
    : `node type "${nodeType}" and action "${action}"`;
}

export function createOrchestratorRegistry(
  values: readonly unknown[],
): OrchestratorRegistry {
  const contributions: OrchestratorIntegrationContribution[] = [];
  const contributionIds = new Set<string>();
  const seenExecutorActions = new Map<string, Set<string | undefined>>();
  const actionExecutors = new Map<
    string,
    Map<string, ResolvedOrchestratorExecutor>
  >();
  const defaultExecutors = new Map<string, ResolvedOrchestratorExecutor>();

  values.forEach((value, index) => {
    assertContribution(value, index);

    if (contributionIds.has(value.id)) {
      throw new OrchestratorRegistryError(
        `Duplicate orchestrator contribution id "${value.id}".`,
      );
    }

    contributionIds.add(value.id);
    contributions.push(value);

    for (const executor of value.executors) {
      const registration = {
        contributionId: value.id,
        executor,
      } satisfies ResolvedOrchestratorExecutor;
      let nodeActions = seenExecutorActions.get(executor.nodeType);
      if (!nodeActions) {
        nodeActions = new Set<string | undefined>();
        seenExecutorActions.set(executor.nodeType, nodeActions);
      }

      if (nodeActions.has(executor.action)) {
        throw new OrchestratorRegistryError(
          `Duplicate orchestrator executor for ${executorDescription(executor.nodeType, executor.action)}.`,
        );
      }
      nodeActions.add(executor.action);

      if (executor.action !== undefined) {
        let nodeExecutors = actionExecutors.get(executor.nodeType);
        if (!nodeExecutors) {
          nodeExecutors = new Map<string, ResolvedOrchestratorExecutor>();
          actionExecutors.set(executor.nodeType, nodeExecutors);
        }
        nodeExecutors.set(executor.action, registration);
      }

      const isDefault =
        executor.default === true || executor.action === undefined;
      if (isDefault) {
        if (defaultExecutors.has(executor.nodeType)) {
          throw new OrchestratorRegistryError(
            `Multiple default orchestrator executors registered for node type "${executor.nodeType}".`,
          );
        }
        defaultExecutors.set(executor.nodeType, registration);
      }
    }
  });

  const diagnostics = Object.freeze(
    contributions.map((contribution) =>
      Object.freeze({
        id: contribution.id,
        contractVersion: contribution.contractVersion,
        executors: Object.freeze(
          contribution.executors.map((executor) =>
            Object.freeze({
              nodeType: executor.nodeType,
              ...(executor.action === undefined
                ? {}
                : { action: executor.action }),
              default:
                executor.default === true || executor.action === undefined,
            }),
          ),
        ),
      }),
    ),
  );

  return Object.freeze({
    contributions: Object.freeze([...contributions]),
    diagnostics,
    resolve: (nodeType: string, action?: string) => {
      if (action !== undefined && action.length > 0) {
        return actionExecutors.get(nodeType)?.get(action);
      }
      return defaultExecutors.get(nodeType);
    },
  });
}

export function resolveOrchestratorExecutor(
  registry: OrchestratorRegistry,
  nodeType: string,
  action?: string,
): ResolvedOrchestratorExecutor | undefined {
  return registry.resolve(nodeType, action);
}

export function getOrchestratorDiagnostics(
  registry: OrchestratorRegistry,
): readonly OrchestratorContributionDiagnostic[] {
  return registry.diagnostics;
}
