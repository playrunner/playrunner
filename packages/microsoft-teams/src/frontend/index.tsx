import type { Integration } from '@playrunner/integration-sdk';
import { TeamsConfigPanel } from './TeamsConfigPanel';
import { TeamsSettingsModal } from './TeamsSettingsModal';
import { teamsIconUrl } from './icon';

export const teamsIntegration: Integration = {
  id: 'microsoft-teams',
  name: 'Microsoft Teams',
  category: 'Messaging',
  description: 'Send workflow notifications to Microsoft Teams channels',
  icon: teamsIconUrl,
  nodeType: 'action',
  nodeSelectorOrder: 51,
  getAuthPath: (uid) => `users/${uid}/integrations/microsoft-teams`,
  SettingsModal: TeamsSettingsModal,
  ConfigPanel: TeamsConfigPanel,
};
export default teamsIntegration;
export { TeamsConfigPanel, TeamsSettingsModal, teamsIconUrl };
