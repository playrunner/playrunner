import type { Integration } from '../types';
import { PlaywrightConfigPanel } from './PlaywrightConfigPanel';
import { GithubSettingsModal } from '@playrunner/github';

export const playwrightIntegration: Integration = {
  id: 'playwright',
  name: 'Playwright',
  category: 'Testing',
  description: 'Connect to your Playwright testing suite',
  icon: '/images/integrations/playwright.svg',
  nodeType: 'trigger',
  authProviders: [
    { id: 'github', label: 'GitHub' },
    { id: 'bitbucket', label: 'Bitbucket' },
  ],
  getAuthPath: (uid) => `users/${uid}/integrations/github`,
  SettingsModal: GithubSettingsModal,
  ConfigPanel: PlaywrightConfigPanel,
};
