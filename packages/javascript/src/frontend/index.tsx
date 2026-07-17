import { Code2 } from 'lucide-react';
import type { Integration } from '@playrunner/integration-sdk';
import { JavascriptConfigPanel } from './JavascriptConfigPanel';

export const javascriptIntegration: Integration = {
  id: 'code',
  name: 'Javascript Code',
  category: 'Custom',
  description: 'Run arbitrary javascript code',
  icon: Code2,
  nodeType: 'action',
  color: 'text-yellow-500',
  requiresAuth: false,
  showInIntegrationsPage: false,
  ConfigPanel: JavascriptConfigPanel,
};

export default javascriptIntegration;

export { JavascriptConfigPanel } from './JavascriptConfigPanel';
