import type { Integration } from '@playrunner/integration-sdk';
import { Webhook } from 'lucide-react';
import { WebhooksConfigPanel } from './WebhooksConfigPanel';
import { WebhooksSettingsModal } from './WebhooksSettingsModal';

export const webhooksIntegration: Integration = {
  id: 'webhooks',
  name: 'Webhooks',
  category: 'Custom',
  description: 'Receive inbound events or send generic HTTP requests',
  icon: Webhook,
  nodeType: 'action',
  requiresAuth: false,
  showInputPanel: true,
  ConfigPanel: WebhooksConfigPanel,
  SettingsModal: WebhooksSettingsModal,
};

export default webhooksIntegration;

export { WebhooksConfigPanel } from './WebhooksConfigPanel';
export { WebhooksSettingsModal } from './WebhooksSettingsModal';
