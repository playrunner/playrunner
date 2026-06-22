import type React from 'react';
import { editionCloudProviders } from '@edition-runtime';

export type CloudProvider = {
  credentialId?: string;
  disabled?: boolean;
  disabledReason?: string;
  icon?: string;
  id: string;
  isPremiumFeature?: boolean;
  label: string;
  SettingsModal?: React.ComponentType<{
    isOpen: boolean;
    onClose: () => void;
    cloudId: string;
  }>;
};

const disabledCloudRunnerMessage =
  'This runner is currently in development and will be available soon.';

const baseProviders: CloudProvider[] = [
  {
    id: 'LOCAL_RUNNER',
    label: 'Local Runner',
  },
  {
    disabled: true,
    disabledReason: disabledCloudRunnerMessage,
    icon: '/images/integrations/aws.svg',
    id: 'AWS',
    isPremiumFeature: true,
    label: 'AWS Runner',
  },
  {
    disabled: true,
    disabledReason: disabledCloudRunnerMessage,
    icon: '/images/integrations/gcp.svg',
    id: 'GCP',
    isPremiumFeature: true,
    label: 'GCP Runner',
  },
  {
    disabled: true,
    disabledReason: disabledCloudRunnerMessage,
    icon: '/images/integrations/azure.svg',
    id: 'AZURE',
    isPremiumFeature: true,
    label: 'Azure Runner',
  },
];

const providerRegistry = new Map<string, CloudProvider>();

for (const provider of [...baseProviders, ...editionCloudProviders]) {
  providerRegistry.set(provider.id, provider);
}

export const CLOUD_PROVIDERS: CloudProvider[] = Array.from(
  providerRegistry.values(),
);

export function getCloudProvider(id: string): CloudProvider | undefined {
  return CLOUD_PROVIDERS.find((provider) => provider.id === id);
}

export function getDefaultCloudProviderId(): string {
  const saved = localStorage.getItem('primaryCloud') || '';
  const savedProvider = getCloudProvider(saved);
  if (savedProvider && !savedProvider.disabled) {
    return saved;
  }

  return 'LOCAL_RUNNER';
}
