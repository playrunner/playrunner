import type {
  Integration,
  IntegrationOutputVariable,
} from '@playrunner/integration-sdk';
import { GithubConfigPanel } from './GithubConfigPanel';
import { GithubSettingsModal } from './GithubSettingsModal';
import { GithubIcon } from './GithubIcon';

const issueOutputVariables: readonly IntegrationOutputVariable[] = [
  { path: 'result.status', type: 'string' },
  { path: 'result.data', type: 'object', description: 'GitHub issue' },
  {
    path: 'result.data.number',
    type: 'number',
    description: 'Repository-scoped issue number used by other issue actions',
  },
  {
    path: 'result.data.id',
    type: 'number',
    description: 'GitHub global database ID',
  },
  { path: 'result.data.title', type: 'string' },
  { path: 'result.data.body', type: 'string' },
  { path: 'result.data.state', type: 'string' },
  { path: 'result.data.url', type: 'url' },
  { path: 'result.data.apiUrl', type: 'url' },
  { path: 'error.message', type: 'string' },
];

const commentOutputVariables: readonly IntegrationOutputVariable[] = [
  { path: 'result.status', type: 'string' },
  { path: 'result.data', type: 'object', description: 'GitHub comment' },
  { path: 'result.data.id', type: 'number' },
  { path: 'result.data.body', type: 'string' },
  { path: 'result.data.url', type: 'url' },
  { path: 'result.data.apiUrl', type: 'url' },
  { path: 'result.data.issueApiUrl', type: 'url' },
  { path: 'error.message', type: 'string' },
];

export const githubIntegration: Integration = {
  id: 'github',
  name: 'GitHub',
  category: 'Version Control',
  description: 'Manage GitHub issues, comments, and pull requests',
  icon: GithubIcon,
  nodeType: 'action',
  nodeSelectorOrder: 35,
  iconRenderMode: 'mask',
  getAuthPath: (uid) => `users/${uid}/integrations/github`,
  getOutputVariables: (config) =>
    config.action === 'comment' ? commentOutputVariables : issueOutputVariables,
  SettingsModal: GithubSettingsModal,
  ConfigPanel: GithubConfigPanel,
};

export default githubIntegration;

export { GithubIcon } from './GithubIcon';
export { GithubConfigPanel } from './GithubConfigPanel';
export { GithubSettingsModal } from './GithubSettingsModal';
export { githubIconUrl } from './icon';
