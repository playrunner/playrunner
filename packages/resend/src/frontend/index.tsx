import type { Integration } from '@playrunner/integration-sdk';
import { ResendConfigPanel } from './ResendConfigPanel';
import { ResendIcon } from './ResendIcon';
import { ResendSettingsModal } from './ResendSettingsModal';

export const resendIntegration: Integration = {
  id: 'resend',
  name: 'Resend',
  category: 'Communication',
  description: 'Send email or wait for inbound email in a workflow',
  icon: ResendIcon,
  iconRenderMode: 'mask',
  nodeType: 'action',
  nodeSelectorOrder: 45,
  getAuthPath: (uid) => `users/${uid}/integrations/resend`,
  SettingsModal: ResendSettingsModal,
  ConfigPanel: ResendConfigPanel,
};

export default resendIntegration;

export { ResendConfigPanel } from './ResendConfigPanel';
export { ResendIcon } from './ResendIcon';
export { ResendSettingsModal } from './ResendSettingsModal';
export { resendIconUrl } from './icon';
