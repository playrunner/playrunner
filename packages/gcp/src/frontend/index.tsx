import type { Integration } from '@playrunner/integration-sdk';
import { GcpSettingsModal } from './GcpSettingsModal';
import { gcpIconUrl } from './icon';

export const gcpIntegration: Integration = {
  id: 'gcp',
  name: 'Google Cloud',
  category: 'Cloud Providers',
  description: 'Connect to Google Cloud Platform',
  icon: gcpIconUrl,
  nodeType: 'trigger',
  getAuthPath: (uid) => `users/${uid}/cloud_credentials/gcp`,
  showInNodeSelector: false,
  SettingsModal: (props) => <GcpSettingsModal {...props} cloudId="gcp" />,
};

export const gcpCloudProvider = {
  credentialId: 'gcp',
  icon: gcpIconUrl,
  id: 'GCP',
  label: 'GCP Runner',
  SettingsModal: GcpSettingsModal,
};

export { GcpSettingsModal } from './GcpSettingsModal';
export { gcpIconUrl } from './icon';
export { refreshGcpCloudCredentialIfNeeded } from './tokenRefresh';
