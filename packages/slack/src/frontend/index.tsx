import type { Integration } from '@playrunner/integration-sdk';
import { SlackConfigPanel } from './SlackConfigPanel';
import { SlackSettingsModal } from './SlackSettingsModal';
import { slackIconUrl } from './icon';

export const slackIntegration: Integration = {
  id: 'slack',
  name: 'Slack',
  category: 'Messaging',
  description: 'Send notifications and alerts to Slack',
  icon: slackIconUrl,
  nodeType: 'action',
  nodeSelectorOrder: 50,
  getAuthPath: (uid) => `users/${uid}/integrations/slack`,
  SettingsModal: SlackSettingsModal,
  ConfigPanel: SlackConfigPanel,
};

export { SlackConfigPanel } from './SlackConfigPanel';
export { SlackSettingsModal } from './SlackSettingsModal';
export { slackIconUrl } from './icon';
