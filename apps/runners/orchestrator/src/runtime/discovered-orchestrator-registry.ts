import {
  createOrchestratorRegistry,
  OrchestratorRegistryError,
} from './orchestrator-registry';
import { discoveredIntegrationContributions } from '../generated/package-contributions';

export function createDiscoveredOrchestratorRegistry(
  entries: readonly {
    packageName: string;
    integrationId: string;
    contribution: unknown;
  }[],
) {
  const contributions = entries.map((entry) => {
    if (
      typeof entry.contribution !== 'object' ||
      entry.contribution === null ||
      Array.isArray(entry.contribution)
    ) {
      throw new OrchestratorRegistryError(
        `Integration package "${entry.packageName}" did not default-export an orchestrator contribution object.`,
      );
    }

    const contribution = entry.contribution as { id?: unknown };
    if (contribution.id !== entry.integrationId) {
      throw new OrchestratorRegistryError(
        `Integration package "${entry.packageName}" declares id "${entry.integrationId}" but its orchestrator contribution has id "${String(contribution.id)}".`,
      );
    }

    return entry.contribution;
  });

  return createOrchestratorRegistry(contributions);
}

export const packageOrchestratorRegistry = createDiscoveredOrchestratorRegistry(
  discoveredIntegrationContributions,
);
