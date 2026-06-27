import type { Integration } from '../types';
import { GcpSettingsModal } from './GcpSettingsModal';

export const gcpIntegration: Integration = {
  id: 'gcp',
  name: 'Google Cloud',
  category: 'Cloud Providers',
  description: 'Connect to Google Cloud Platform',
  icon: '/images/integrations/gcp.svg',
  nodeType: 'trigger',
  getAuthPath: (uid) => `users/${uid}/cloud_credentials/gcp`,
  showInNodeSelector: false,
  SettingsModal: (props) => GcpSettingsModal({ ...props, cloudId: 'gcp' }),
};
