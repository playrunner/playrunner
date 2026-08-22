import type { Integration } from '@playrunner/integration-sdk';
import { JiraConfigPanel } from './JiraConfigPanel';
import { JiraSettingsModal } from './JiraSettingsModal';
import { jiraIconUrl } from './icon';

export const jiraIntegration: Integration = {
  id: 'jira',
  name: 'Jira',
  category: 'Project Management',
  description: 'Read, create, and update Jira tickets',
  icon: jiraIconUrl,
  nodeType: 'action',
  nodeSelectorOrder: 40,
  attachmentKind: 'tool',
  getAuthPath: (uid) => `users/${uid}/integrations/jira`,
  SettingsModal: JiraSettingsModal,
  ConfigPanel: JiraConfigPanel,
  getOutputVariables: () => [
    {
      path: 'acceptanceCriteria.id',
      type: 'string',
      description: 'Jira issue key',
    },
    {
      path: 'acceptanceCriteria.title',
      type: 'string',
      description: 'Jira issue summary',
    },
    {
      path: 'acceptanceCriteria.body',
      type: 'string',
      description: 'Jira issue description',
    },
  ],
};

export default jiraIntegration;

export { JiraConfigPanel } from './JiraConfigPanel';
export { JiraSettingsModal } from './JiraSettingsModal';
export { jiraIconUrl } from './icon';
