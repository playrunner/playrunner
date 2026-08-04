import React, { useEffect, useRef, useState } from 'react';
import {
  IntegrationConnectionAutofillGuard,
  IntegrationConnectionInput,
  IntegrationConfigField,
  IntegrationSettingsModal,
  useIntegrationHost,
} from '@playrunner/integration-sdk';
import { BookOpen, ExternalLink } from 'lucide-react';
import { createResendApiKeyIntegrationData } from '../connection';
import { ResendIcon } from './ResendIcon';

interface ResendSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_DOCS_URL = 'https://playrunner.dev';
const RESEND_SETUP_DOCS_URL = getDocsUrl(
  'docs/integration-packages/resend#setup',
);

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

type AuthMode = 'oauth' | 'apiKey';

async function authenticatedJson(
  token: string,
  path: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(`/api/resend${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw new Error(
      typeof data.error === 'string' ? data.error : 'Resend setup failed.',
    );
  }
  return data;
}

export function ResendSettingsModal({
  isOpen,
  onClose,
}: ResendSettingsModalProps) {
  const { auth, store } = useIntegrationHost();
  const [authMode, setAuthMode] = useState<AuthMode>('oauth');
  const [apiKey, setApiKey] = useState('');
  const [receivingAddress, setReceivingAddress] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const popupRef = useRef<Window | null>(null);
  const callbackUrl = `${window.location.origin}/oauth/callback/resend`;

  useEffect(() => {
    let active = true;
    if (!isOpen || !auth.currentUser) return;

    void store
      .getIntegration(auth.currentUser.uid, 'resend')
      .then((data) => {
        if (!active || !data) return;
        setIsConnected(Boolean(data.credentialStatus?.configured));
        setAuthMode(data.config?.authMode === 'apiKey' ? 'apiKey' : 'oauth');
        setReceivingAddress(
          typeof data.config?.receivingAddress === 'string'
            ? data.config.receivingAddress
            : '',
        );
      })
      .catch((loadError) => {
        console.error('Failed to load Resend connection', loadError);
      });

    return () => {
      active = false;
    };
  }, [auth, isOpen, store]);

  useEffect(() => {
    if (isOpen) return;
    popupRef.current?.close();
    popupRef.current = null;
    setApiKey('');
    setReceivingAddress('');
    setIsConnected(false);
    setIsSaving(false);
    setError('');
    setAuthMode('oauth');
  }, [isOpen]);

  const closePopup = () => {
    popupRef.current?.postMessage(
      { type: 'oauth_close' },
      window.location.origin,
    );
    popupRef.current = null;
  };

  const connectOAuth = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    popupRef.current = window.open(
      'about:blank',
      'ResendOAuth',
      'toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,width=540,height=720',
    );
    if (!popupRef.current) {
      setError('Allow popups to connect Resend.');
      return;
    }

    setIsSaving(true);
    setError('');
    try {
      const token = await currentUser.getIdToken();
      const start = await authenticatedJson(token, '/oauth/start', {
        redirectUri: callbackUrl,
        receivingAddress: receivingAddress.trim(),
      });
      if (typeof start.authorizationUrl !== 'string') {
        throw new Error('Resend returned an invalid authorization URL.');
      }

      const listener = async (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type !== 'oauth_callback') return;
        window.removeEventListener('message', listener);

        try {
          if (!event.data?.success || !event.data?.params?.code) {
            throw new Error('Resend authorization was cancelled.');
          }
          await authenticatedJson(token, '/oauth/token', {
            code: event.data.params.code,
            state: event.data.params.state,
            redirectUri: callbackUrl,
          });
          setIsConnected(true);
          closePopup();
        } catch (oauthError) {
          setError(
            oauthError instanceof Error
              ? oauthError.message
              : 'Resend authorization failed.',
          );
          closePopup();
        } finally {
          setIsSaving(false);
        }
      };
      window.addEventListener('message', listener);

      popupRef.current.location.href = start.authorizationUrl;
    } catch (saveError) {
      closePopup();
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Resend authorization failed.',
      );
      setIsSaving(false);
    }
  };

  const saveApiKey = async () => {
    if (!auth.currentUser) return;
    setIsSaving(true);
    setError('');
    try {
      await store.saveIntegration(
        auth.currentUser.uid,
        'resend',
        createResendApiKeyIntegrationData(apiKey, receivingAddress),
      );
      setApiKey('');
      setIsConnected(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Save failed.');
    } finally {
      setIsSaving(false);
    }
  };

  const disconnect = async () => {
    if (!auth.currentUser) return;
    await store.deleteIntegration(auth.currentUser.uid, 'resend');
    setApiKey('');
    setReceivingAddress('');
    setIsConnected(false);
    setError('');
  };

  return (
    <IntegrationSettingsModal
      isOpen={isOpen}
      onClose={onClose}
      title="Connect to Resend"
      icon={<ResendIcon className="h-5 w-5 text-[var(--foreground)]" />}
      isConnected={isConnected}
      connectedTitle="Resend Connected Successfully"
      connectedDescription="The Resend node can send email or wait for inbound email in your workflows."
      onChangeCredentials={() => {
        setIsConnected(false);
        setError('');
      }}
      onDisconnect={() => void disconnect()}
      primaryActionLabel={
        authMode === 'oauth' ? 'Connect with Resend' : 'Save API key'
      }
      primaryActionPendingLabel={
        authMode === 'oauth' ? 'Connecting...' : 'Saving...'
      }
      primaryActionPending={isSaving}
      primaryActionDisabled={
        isSaving || (authMode === 'apiKey' && !apiKey.trim())
      }
      onPrimaryAction={() => {
        void (authMode === 'oauth' ? connectOAuth() : saveApiKey());
      }}
    >
      <IntegrationConnectionAutofillGuard connectionId="resend" />

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] p-4 text-left">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--background)]">
            <BookOpen className="h-4 w-4 text-muted" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[var(--foreground)]">
              Resend setup
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Connect securely, configure a sending or receiving domain, and
              learn how to use both Resend operations.
            </p>
            <a
              href={RESEND_SETUP_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--foreground)] underline underline-offset-4 hover:text-muted"
            >
              Open Playrunner setup guide
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </div>

      <div
        className="flex gap-2 border-b border-subtle pb-2"
        role="group"
        aria-label="Resend authentication method"
      >
        {(['oauth', 'apiKey'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setAuthMode(mode)}
            aria-pressed={authMode === mode}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              authMode === mode
                ? 'bg-[var(--accent)] text-[var(--accent-foreground)]'
                : 'text-muted hover:text-[var(--foreground)]'
            }`}
          >
            {mode === 'oauth' ? 'Connect to Resend' : 'API key'}
          </button>
        ))}
      </div>

      {authMode === 'apiKey' ? (
        <IntegrationConfigField label="API key" htmlFor="resend-field-a">
          <IntegrationConnectionInput
            id="resend-field-a"
            connectionId="resend"
            fieldSlot="a"
            mode="secret"
            placeholder="Paste full-access Resend API key"
            value={apiKey}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              setApiKey(event.target.value);
            }}
          />
        </IntegrationConfigField>
      ) : null}

      <IntegrationConfigField
        label="Default receiving address (optional)"
        htmlFor="resend-field-b"
        hint="Shown as the default hint when configuring Wait for Email."
      >
        <IntegrationConnectionInput
          id="resend-field-b"
          connectionId="resend"
          fieldSlot="b"
          mode="text"
          placeholder="login@example.resend.app"
          value={receivingAddress}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            setReceivingAddress(event.target.value);
          }}
        />
      </IntegrationConfigField>

      {error ? (
        <p role="alert" className="text-xs text-red-500">
          {error}
        </p>
      ) : null}
    </IntegrationSettingsModal>
  );
}
