import type { Integration } from '../types';
import { JavascriptConfigPanel } from './JavascriptConfigPanel';
import { Code2 } from 'lucide-react';

export const javascriptIntegration: Integration = {
  id: 'code',
  name: 'Javascript Code',
  category: 'Custom',
  description: 'Run arbitrary javascript code',
  icon: Code2,
  nodeType: 'action',
  color: 'text-yellow-500',
  requiresAuth: false,
  ConfigPanel: JavascriptConfigPanel,
};
