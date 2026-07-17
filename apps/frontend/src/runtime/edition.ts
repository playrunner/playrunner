import type React from 'react';
import { gcpCloudProvider } from '@playrunner/gcp';
import type { Integration } from '../integrations/types';
import type { CloudProvider } from './cloudProviders';
import type { OnboardingModalProps } from './onboarding';

export const editionIntegrations: Integration[] = [];

export const editionCloudProviders: CloudProvider[] = [gcpCloudProvider];

export const editionOnboardingModal:
  | React.ComponentType<OnboardingModalProps>
  | undefined = undefined;
