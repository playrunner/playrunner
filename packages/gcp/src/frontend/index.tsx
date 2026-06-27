import type { Integration } from '@playrunner/integration-sdk';
import { GcpSettingsModal } from './GcpSettingsModal';

export const gcpIconUrl = new URL('../../assets/gcp.svg', import.meta.url).href;

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
export { refreshGcpCloudCredentialIfNeeded } from './tokenRefresh';
