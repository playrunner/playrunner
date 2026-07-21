import type { Integration } from '@playrunner/integration-sdk';
import { OpenAIConfigPanel } from './OpenAIConfigPanel';
import { OpenAIIcon } from './OpenAIIcon';
import { OpenAISettingsModal } from './OpenAISettingsModal';

export const openaiIntegration: Integration = {
  id: 'openai',
  name: 'OpenAI',
  category: 'AI & ML',
  description: 'Generate, analyze, classify, and structure text with OpenAI',
  icon: OpenAIIcon,
  iconRenderMode: 'mask',
  nodeType: 'action',
  nodeSelectorOrder: 60,
  getAuthPath: (uid) => `users/${uid}/integrations/openai`,
  SettingsModal: OpenAISettingsModal,
  ConfigPanel: OpenAIConfigPanel,
};

export default openaiIntegration;

export { OpenAIConfigPanel } from './OpenAIConfigPanel';
export { OpenAIIcon } from './OpenAIIcon';
export { OpenAISettingsModal } from './OpenAISettingsModal';
export { openaiIconUrl } from './icon';
