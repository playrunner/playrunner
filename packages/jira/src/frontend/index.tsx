import type { Integration } from '@playrunner/integration-sdk';
import { JiraConfigPanel } from './JiraConfigPanel';
import { JiraSettingsModal } from './JiraSettingsModal';
import { jiraIconUrl } from './icon';
import { refreshJiraTokenIfNeeded } from './tokenRefresh';

export const jiraIntegration: Integration = {
  id: 'jira',
  name: 'Jira',
  category: 'Project Management',
  description: 'Create and sync Jira tickets',
  icon: jiraIconUrl,
  nodeType: 'action',
  nodeSelectorOrder: 40,
  getAuthPath: (uid) => `users/${uid}/integrations/jira`,
  SettingsModal: JiraSettingsModal,
  ConfigPanel: JiraConfigPanel,
  refreshStoredIntegration: refreshJiraTokenIfNeeded,
};

export default jiraIntegration;

export { JiraConfigPanel } from './JiraConfigPanel';
export { JiraSettingsModal } from './JiraSettingsModal';
export { jiraIconUrl } from './icon';
