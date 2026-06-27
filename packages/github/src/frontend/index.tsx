import type { Integration } from '@playrunner/integration-sdk';
import { GithubSettingsModal } from './GithubSettingsModal';
import { githubIconUrl } from './icon';

export const githubIntegration: Integration = {
  id: 'github',
  name: 'GitHub',
  category: 'Version Control',
  description: 'Sync repositories and trigger actions',
  icon: githubIconUrl,
  nodeType: 'trigger',
  getAuthPath: (uid) => `users/${uid}/integrations/github`,
  SettingsModal: GithubSettingsModal,
};

export { GithubSettingsModal } from './GithubSettingsModal';
export { githubIconUrl } from './icon';
