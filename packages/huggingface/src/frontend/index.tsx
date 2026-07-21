import type { Integration } from '@playrunner/integration-sdk';
import { HuggingFaceConfigPanel } from './HuggingFaceConfigPanel';
import { HuggingFaceSettingsModal } from './HuggingFaceSettingsModal';
import { huggingFaceIconUrl } from './icon';

export const huggingFaceIntegration: Integration = {
  id: 'huggingface',
  name: 'Hugging Face',
  category: 'AI & ML',
  description: 'Run hosted open-source models with Hugging Face',
  icon: huggingFaceIconUrl,
  nodeType: 'action',
  nodeSelectorOrder: 61,
  getAuthPath: (uid) => `users/${uid}/integrations/huggingface`,
  SettingsModal: HuggingFaceSettingsModal,
  ConfigPanel: HuggingFaceConfigPanel,
};

export default huggingFaceIntegration;

export { HuggingFaceConfigPanel } from './HuggingFaceConfigPanel';
export { HuggingFaceSettingsModal } from './HuggingFaceSettingsModal';
export { huggingFaceIconUrl } from './icon';
