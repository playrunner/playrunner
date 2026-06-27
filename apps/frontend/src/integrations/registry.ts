import type { Integration } from './types';
import { packageIntegrationRegistry } from '@playrunner/integration-registry';
import { editionIntegrations } from '@edition-runtime';

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
