import type { Integration } from './types';
import { discoveredIntegrationContributions } from './generated-package-contributions';
import { editionIntegrations } from '@edition-runtime';

function createPackageIntegrationRegistry(
  entries: readonly {
    packageName: string;
    integrationId: string;
    contribution: unknown;
  }[],
): Record<string, Integration> {
  const registry: Record<string, Integration> = Object.create(null);

  for (const entry of entries) {
    if (
      typeof entry.contribution !== 'object' ||
      entry.contribution === null ||
      Array.isArray(entry.contribution)
    ) {
      throw new Error(
        `Integration package "${entry.packageName}" did not default-export an integration object.`,
      );
    }

    const integration = entry.contribution as Partial<Integration>;
    if (integration.id !== entry.integrationId) {
      throw new Error(
        `Integration package "${entry.packageName}" declares id "${entry.integrationId}" but its frontend contribution has id "${String(integration.id)}".`,
      );
    }

    if (Object.hasOwn(registry, entry.integrationId)) {
      throw new Error(
        `Duplicate frontend integration id "${entry.integrationId}".`,
      );
    }

    registry[entry.integrationId] = integration as Integration;
  }

  return registry;
}

const packageIntegrationRegistry = createPackageIntegrationRegistry(
  discoveredIntegrationContributions,
);

function createPremiumIntegrationStub(
  id: string,
  name: string,
  description: string,
  icon: string,
): Integration {
  return {
    category: 'Cloud Providers',
    description,
    disabled: true,
    disabledReason:
      'This cloud provider is currently in development and will be available soon.',
    icon,
    id,
    isPremiumFeature: true,
    name,
    nodeType: 'trigger',
    showInNodeSelector: false,
  };
}

export const REGISTRY: Record<string, Integration> = {
  ...packageIntegrationRegistry,

  aws: createPremiumIntegrationStub(
    'aws',
    'AWS Cloud',
    'Connect to your AWS infrastructure',
    '/images/integrations/aws.svg',
  ),
  azure: createPremiumIntegrationStub(
    'azure',
    'Azure Cloud',
    'Connect to Microsoft Azure',
    '/images/integrations/azure.svg',
  ),
  ...Object.fromEntries(
    editionIntegrations.map((integration) => [integration.id, integration]),
  ),
};

export const INTEGRATIONS = Object.values(REGISTRY);

export function getIntegration(id: string): Integration | undefined {
  return REGISTRY[id];
}
