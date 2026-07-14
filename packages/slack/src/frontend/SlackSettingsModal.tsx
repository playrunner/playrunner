import React, { useState } from 'react';
import {
  IntegrationCopyableCode,
  IntegrationConfigField,
  IntegrationSettingsModal,
  useIntegrationHost,
} from '@playrunner/integration-sdk';
import { slackIconUrl } from './icon';

interface SlackSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_DOCS_URL = 'https://docs.playrunner.dev';
const SLACK_SETUP_DOCS_URL = getDocsUrl('docs/integration-packages/slack');

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

type AuthMode = 'oauth' | 'webhook';

export function SlackSettingsModal({
  isOpen,
  onClose,
}: SlackSettingsModalProps) {
  const { auth, store, ui } = useIntegrationHost();
  const [authMode, setAuthMode] = useState<AuthMode>('oauth');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authSuccess, setAuthSuccess] = useState(false);
  const popupRef = React.useRef<Window | null>(null);
  const Input = ui.Input;

  const callbackUrl = `${window.location.origin}/oauth/callback/slack`;

  React.useEffect(() => {
    let isMounted = true;

    const fetchCredentials = async () => {
      if (!isOpen || !auth.currentUser) return;

      try {
        const data = await store.getIntegration(
          auth.currentUser.uid,
          'slack',
        );

        if (!data || !isMounted) return;

        if (data.authMode === 'webhook' && data.webhookUrl) {
          setAuthMode('webhook');
          setWebhookUrl(data.webhookUrl);
          setAuthSuccess(true);
        } else if (data.clientId) {
          setAuthMode('oauth');
          setClientId(data.clientId);
          setClientSecret(data.clientSecret || '');

          if (data.accessToken) {
            setAuthSuccess(true);
          }
        }
      } catch (error) {
        console.error('Failed to fetch Slack credentials', error);
      }
    };

    if (isOpen) {
      void fetchCredentials();
    } else {
      setAuthSuccess(false);
      setIsAuthenticating(false);
      setClientId('');
      setClientSecret('');
      setWebhookUrl('');
      setAuthMode('oauth');
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

  const handleSaveWebhook = async () => {
    if (!auth.currentUser || !webhookUrl.trim()) return;

    try {
      setIsAuthenticating(true);

      await store.saveIntegration(auth.currentUser.uid, 'slack', {
        authMode: 'webhook',
        webhookUrl: webhookUrl.trim(),
        updatedAt: new Date().toISOString(),
      });

      setAuthSuccess(true);
    } catch (error) {
      console.error('Failed to save Slack webhook', error);
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleAuthenticateOAuth = async () => {
    try {
      setIsAuthenticating(true);

      const currentUser = auth.currentUser;

      if (currentUser) {
        await store.saveIntegration(currentUser.uid, 'slack', {
          authMode: 'oauth',
          clientId,
          clientSecret,
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
          const tokenRes = await fetch('/api/slack/oauth-token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              code: event.data.params.code,
              client_id: clientId,
              client_secret: clientSecret,
              redirect_uri: callbackUrl,
            }),
          });

          const tokenData = await tokenRes.json();

          if (!tokenRes.ok || !tokenData.access_token) {
            throw new Error(
              `Failed to retrieve access token: ${JSON.stringify(tokenData)}`,
            );
          }

          await store.saveIntegration(auth.currentUser.uid, 'slack', {
            authMode: 'oauth',
            clientId,
            clientSecret,
            accessToken: tokenData.access_token,
            teamId: tokenData.team?.id,
            teamName: tokenData.team?.name,
            botUserId: tokenData.bot_user_id,
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
          alert(`Failed to authenticate with Slack. Details: ${message}`);
          closePopup();
        }
      };

      window.addEventListener('message', messageListener);

      const redirectUri = encodeURIComponent(callbackUrl);
      const scopes = encodeURIComponent(
        'chat:write,channels:read,groups:read',
      );
      const authUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${redirectUri}&response_type=code`;
      const width = 500;
      const height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;

      popupRef.current = window.open(
        authUrl,
        'SlackOAuth',
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
      await store.deleteIntegration(auth.currentUser.uid, 'slack');
      setAuthSuccess(false);
      setClientId('');
      setClientSecret('');
      setWebhookUrl('');
    } catch (error) {
      console.error('Failed to disconnect Slack', error);
    }
  };

  const primaryActionLabel =
    authMode === 'oauth' ? 'Authenticate' : 'Save Webhook';
  const primaryActionPendingLabel =
    authMode === 'oauth' ? 'Authenticating...' : 'Saving...';
  const primaryActionDisabled =
    authMode === 'oauth'
      ? !clientId || !clientSecret || isAuthenticating
      : !webhookUrl.trim() || isAuthenticating;
  const onPrimaryAction =
    authMode === 'oauth' ? handleAuthenticateOAuth : handleSaveWebhook;

  return (
    <IntegrationSettingsModal
      isOpen={isOpen}
      onClose={onClose}
      title="Connect to Slack"
      icon={
        <img
          src={slackIconUrl}
          alt="Slack"
          className="w-5 h-5 object-contain"
        />
      }
      isConnected={authSuccess}
      connectedTitle="Slack Connected Successfully"
      connectedDescription="Your Slack workspace has been securely linked and is ready to use."
      onChangeCredentials={() => setAuthSuccess(false)}
      onDisconnect={handleDisconnect}
      primaryActionLabel={primaryActionLabel}
      primaryActionPendingLabel={primaryActionPendingLabel}
      primaryActionPending={isAuthenticating}
      primaryActionDisabled={primaryActionDisabled}
      onPrimaryAction={onPrimaryAction}
    >
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] p-4 text-left">
        <p className="text-sm font-medium text-[var(--foreground)]">
          Slack setup
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Create a Slack App with OAuth and Bot Token scopes, then enter the
          credentials below. Alternatively, use an incoming webhook for
          simple notifications.
        </p>
        <a
          href={SLACK_SETUP_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex text-xs font-medium text-[var(--foreground)] underline underline-offset-4 hover:text-muted"
        >
          Open Slack setup guide
        </a>
      </div>

      <div className="flex gap-2 border-b border-subtle pb-2">
        <button
          type="button"
          onClick={() => setAuthMode('oauth')}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            authMode === 'oauth'
              ? 'bg-[var(--accent)] text-[var(--accent-foreground)]'
              : 'text-muted hover:text-[var(--foreground)]'
          }`}
        >
          OAuth (recommended)
        </button>
        <button
          type="button"
          onClick={() => setAuthMode('webhook')}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            authMode === 'webhook'
              ? 'bg-[var(--accent)] text-[var(--accent-foreground)]'
              : 'text-muted hover:text-[var(--foreground)]'
          }`}
        >
          Incoming Webhook
        </button>
      </div>

      {authMode === 'oauth' ? (
        <>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted">Redirect URL</p>
            <p className="text-xs leading-relaxed text-muted">
              Use this value as the OAuth redirect URL in your Slack App
              settings.
            </p>
            <IntegrationCopyableCode value={callbackUrl} />
          </div>

          <div className="space-y-4 border-t border-subtle pt-2">
            <IntegrationConfigField label="Client ID">
              <Input
                placeholder="Enter Slack Client ID"
                value={clientId}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setClientId(event.target.value);
                }}
              />
            </IntegrationConfigField>
            <IntegrationConfigField label="Client Secret">
              <Input
                type="password"
                placeholder="Enter Slack Client Secret"
                value={clientSecret}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setClientSecret(event.target.value);
                }}
              />
            </IntegrationConfigField>
          </div>
        </>
      ) : (
        <div className="space-y-4 border-t border-subtle pt-2">
          <IntegrationConfigField
            label="Webhook URL"
            hint="Paste the incoming webhook URL from your Slack App."
          >
            <Input
              type="password"
              placeholder="https://hooks.slack.com/services/..."
              value={webhookUrl}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                setWebhookUrl(event.target.value);
              }}
            />
          </IntegrationConfigField>
        </div>
      )}
    </IntegrationSettingsModal>
  );
}
