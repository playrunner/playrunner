import React, { useState } from 'react';
import {
  IntegrationCopyableCode,
  IntegrationConfigField,
  IntegrationSettingsModal,
  useIntegrationHost,
} from '@playrunner/integration-sdk';
import { jiraIconUrl } from './icon';

interface JiraSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_DOCS_URL = 'https://docs.playrunner.dev';
const JIRA_SETUP_DOCS_URL = getDocsUrl('docs/integration-packages/jira');

type DocsImportMeta = ImportMeta & {
  env?: {
    VITE_DOCS_URL?: string;
  };
};

function getDocsUrl(path = '') {
  const baseUrl = (
    (import.meta as DocsImportMeta).env?.VITE_DOCS_URL || DEFAULT_DOCS_URL
  )
    .trim()
    .replace(/\/+$/, '');
  const normalizedPath = path.trim().replace(/^\/+/, '');

  return normalizedPath ? `${baseUrl}/${normalizedPath}` : baseUrl;
}

export function JiraSettingsModal({ isOpen, onClose }: JiraSettingsModalProps) {
  const { auth, store, ui } = useIntegrationHost();
  const [jiraClientId, setJiraClientId] = useState('');
  const [jiraClientSecret, setJiraClientSecret] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authSuccess, setAuthSuccess] = useState(false);
  const popupRef = React.useRef<Window | null>(null);
  const Input = ui.Input;

  const callbackUrl = `${window.location.origin}/oauth/callback/jira`;

  React.useEffect(() => {
    let isMounted = true;

    const fetchCredentials = async () => {
      if (!isOpen || !auth.currentUser) return;

      try {
        const data = await store.getIntegration(auth.currentUser.uid, 'jira');

        if (!data || !isMounted) return;

        if (data.clientId) {
          setJiraClientId(data.clientId);
          setJiraClientSecret(data.clientSecret || '');
        }

        if (data.clientId && data.accessToken) {
          setAuthSuccess(true);
        }
      } catch (error) {
        console.error('Failed to fetch Jira credentials', error);
      }
    };

    if (isOpen) {
      void fetchCredentials();
    } else {
      setAuthSuccess(false);
      setIsAuthenticating(false);
      setJiraClientId('');
      setJiraClientSecret('');
    }

    return () => {
      isMounted = false;
    };
  }, [auth, isOpen, store]);

  const closePopup = () => {
    if (popupRef.current) {
      popupRef.current.postMessage(
        { type: 'oauth_close' },
        window.location.origin,
      );
    }
  };

  const handleAuthenticateJira = async () => {
    try {
      setIsAuthenticating(true);

      const currentUser = auth.currentUser;

      if (currentUser) {
        await store.saveIntegration(currentUser.uid, 'jira', {
          clientId: jiraClientId,
          clientSecret: jiraClientSecret,
          updatedAt: new Date().toISOString(),
        });
      }

      const messageListener = async (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type !== 'oauth_callback') return;

        window.removeEventListener('message', messageListener);

        if (
          !event.data?.success ||
          !auth.currentUser ||
          !event.data?.params?.code
        ) {
          setIsAuthenticating(false);
          closePopup();
          return;
        }

        try {
          const token = await auth.currentUser.getIdToken();
          const tokenRes = await fetch('/api/jira/token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              code: event.data.params.code,
              client_id: jiraClientId,
              client_secret: jiraClientSecret,
              redirect_uri: callbackUrl,
            }),
          });

          const tokenData = await tokenRes.json();

          if (!tokenRes.ok || !tokenData.access_token) {
            throw new Error(
              `Failed to retrieve access token: ${JSON.stringify(tokenData)}`,
            );
          }

          await store.saveIntegration(auth.currentUser.uid, 'jira', {
            clientId: jiraClientId,
            clientSecret: jiraClientSecret,
            code: event.data.params.code,
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt: tokenData.expires_in
              ? Date.now() + tokenData.expires_in * 1000
              : undefined,
            updatedAt: new Date().toISOString(),
          });

          setIsAuthenticating(false);
          setAuthSuccess(true);
          closePopup();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.error('Failed to save auth code:', error);
          setIsAuthenticating(false);
          alert(`Failed to authenticate with Jira. Details: ${message}`);
          closePopup();
        }
      };

      window.addEventListener('message', messageListener);

      const redirectUri = encodeURIComponent(callbackUrl);
      const authUrl = `https://auth.atlassian.com/authorize?audience=api.atlassian.com&client_id=${jiraClientId}&scope=read:jira-work%20write:jira-work%20offline_access&redirect_uri=${redirectUri}&state=123&response_type=code&prompt=consent`;
      const width = 500;
      const height = 600;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;

      popupRef.current = window.open(
        authUrl,
        'JiraOAuth',
        `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width=${width}, height=${height}, top=${top}, left=${left}`,
      );

      const checkPopup = window.setInterval(() => {
        if (!popupRef.current || popupRef.current.closed) {
          window.clearInterval(checkPopup);
          setIsAuthenticating(false);
          window.removeEventListener('message', messageListener);
        }
      }, 500);
    } catch (error) {
      console.error('Failed to save credentials', error);
      setIsAuthenticating(false);
    }
  };

  const handleDisconnect = async () => {
    if (!auth.currentUser) return;

    try {
      await store.deleteIntegration(auth.currentUser.uid, 'jira');
      setAuthSuccess(false);
      setJiraClientId('');
      setJiraClientSecret('');
    } catch (error) {
      console.error('Failed to disconnect Jira', error);
    }
  };

  return (
    <IntegrationSettingsModal
      isOpen={isOpen}
      onClose={onClose}
      title="Connect to Jira"
      icon={
        <img src={jiraIconUrl} alt="Jira" className="w-5 h-5 object-contain" />
      }
      isConnected={authSuccess}
      connectedTitle="Jira Connected Successfully"
      connectedDescription="Your Jira workspace has been securely linked and is ready to use."
      onChangeCredentials={() => setAuthSuccess(false)}
      onDisconnect={handleDisconnect}
      primaryActionLabel="Authenticate"
      primaryActionPendingLabel="Authenticating..."
      primaryActionPending={isAuthenticating}
      primaryActionDisabled={
        !jiraClientId || !jiraClientSecret || isAuthenticating
      }
      onPrimaryAction={handleAuthenticateJira}
    >
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] p-4 text-left">
        <p className="text-sm font-medium text-[var(--foreground)]">
          Jira OAuth setup
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Use the setup guide to create the Atlassian OAuth integration, assign
          Jira scopes, and find the client ID and secret.
        </p>
        <a
          href={JIRA_SETUP_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex text-xs font-medium text-[var(--foreground)] underline underline-offset-4 hover:text-muted"
        >
          Open Jira setup guide
        </a>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted">Callback URL</p>
        <p className="text-xs leading-relaxed text-muted">
          Use this value when the setup guide asks for the Jira callback URL.
        </p>
        <IntegrationCopyableCode value={callbackUrl} />
      </div>

      <div className="space-y-4 border-t border-subtle pt-2">
        <IntegrationConfigField label="Client ID">
          <Input
            placeholder="Enter Jira Client ID"
            value={jiraClientId}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              setJiraClientId(event.target.value);
            }}
          />
        </IntegrationConfigField>
        <IntegrationConfigField label="Client Secret">
          <Input
            type="password"
            placeholder="Enter Jira Client Secret"
            value={jiraClientSecret}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              setJiraClientSecret(event.target.value);
            }}
          />
        </IntegrationConfigField>
      </div>
    </IntegrationSettingsModal>
  );
}
