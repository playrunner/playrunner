import type React from 'react';

export interface Integration {
  id: string;
  name: string; // Used as nodeLabel and in UI
  category: string;
  description: string;
  icon: string | React.ComponentType<{ className?: string }>;
  connected?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  isPremiumFeature?: boolean;

  // Node info
  nodeType?: 'trigger' | 'action' | 'config';
  color?: string;

  // Modals / UI
  SettingsModal?: React.FC<{ isOpen: boolean; onClose: () => void }>;

  // Auth
  requiresAuth?: boolean;
  authProviderId?: string; // if this delegates to another integration's auth (e.g. playwright uses github)
  authProviders?: { id: string; label: string }[]; // if multiple options are available
  getAuthPath?: (uid: string) => string; // e.g. users/${uid}/integrations/github

  // Config Panel Component
  ConfigPanel?: React.FC<{
    config: Record<string, any>;
    onChange: (nodeId: string, newConfig: Record<string, any>) => void;
    nodeId: string;
    nodeLabel?: string;
    isConnected: boolean;
    onConnectOAuth?: (providerId?: string) => void;
    integrationData?: any;
    onLabelChange?: (newLabel: string) => void;
  }>;
}
