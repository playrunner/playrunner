import type { Integration } from '@playrunner/integration-sdk';
import { GithubConfigPanel } from './GithubConfigPanel';
import { GithubSettingsModal } from './GithubSettingsModal';
import { GithubIcon } from './GithubIcon';

export const githubIntegration: Integration = {
  id: 'github',
  name: 'GitHub',
  category: 'Version Control',
  description: 'Create and read GitHub issues',
  icon: GithubIcon,
  nodeType: 'action',
  nodeSelectorOrder: 35,
  iconRenderMode: 'mask',
  getAuthPath: (uid) => `users/${uid}/integrations/github`,
  SettingsModal: GithubSettingsModal,
  ConfigPanel: GithubConfigPanel,
};

export default githubIntegration;

export { GithubIcon } from './GithubIcon';
export { GithubConfigPanel } from './GithubConfigPanel';
export { GithubSettingsModal } from './GithubSettingsModal';
export { githubIconUrl } from './icon';
