import type { Integration } from '@playrunner/integration-sdk';
import { EnvironmentConfigPanel } from './EnvironmentConfigPanel';
import { Settings } from 'lucide-react';

export const environmentIntegration: Integration = {
  id: 'environment',
  name: 'Environment',
  category: 'Config',
  description: 'Configure environment variables',
  icon: Settings,
  nodeType: 'config',
  color: 'text-blue-500',
  requiresAuth: false,
  ConfigPanel: EnvironmentConfigPanel,
};

export { EnvironmentConfigPanel } from './EnvironmentConfigPanel';
export { VariablesTable } from './VariablesTable';
export type { EnvVar, SavedEnvironment } from './types';
