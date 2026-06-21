import type { Integration } from '../types';
import { JiraSettingsModal } from './JiraSettingsModal';
import { JiraConfigPanel } from './JiraConfigPanel';

export const jiraIntegration: Integration = {
  id: 'jira',
  name: 'Jira',
  category: 'Project Management',
  description: 'Create and sync Jira tickets',
  icon: '/images/integrations/jira.svg',
  nodeType: 'action',
  getAuthPath: (uid) => `users/${uid}/integrations/jira`,
  SettingsModal: JiraSettingsModal,
  ConfigPanel: JiraConfigPanel,
};
