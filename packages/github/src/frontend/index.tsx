import type { Integration } from '@playrunner/integration-sdk';
import { GithubSettingsModal } from './GithubSettingsModal';
import { GithubIcon } from './GithubIcon';
import { refreshGithubTokenIfNeeded } from './tokenRefresh';

export const githubIntegration: Integration = {
  id: 'github',
  name: 'GitHub',
  category: 'Version Control',
  description: 'Sync repositories and trigger actions',
  icon: GithubIcon,
  nodeType: 'trigger',
  iconRenderMode: 'mask',
  getAuthPath: (uid) => `users/${uid}/integrations/github`,
  SettingsModal: GithubSettingsModal,
  refreshStoredIntegration: refreshGithubTokenIfNeeded,
};

export default githubIntegration;

export { GithubIcon } from './GithubIcon';
export { GithubSettingsModal } from './GithubSettingsModal';
export { githubIconUrl } from './icon';
