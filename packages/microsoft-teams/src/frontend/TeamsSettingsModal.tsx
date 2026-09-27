import { useEffect, useRef, useState } from 'react';
import {
  IntegrationConfigField,
  IntegrationConnectionInput,
  IntegrationCopyableCode,
  IntegrationSettingsModal,
  useIntegrationHost,
} from '@playrunner/integration-sdk';
import { BookOpen, ExternalLink } from 'lucide-react';
import { teamsIconUrl } from './icon';
import { createTeamsAuthorization, isTeamsCallback } from './oauth';

const DEFAULT_DOCS_URL = 'https://playrunner.dev';
const TEAMS_SETUP_DOCS_URL = getDocsUrl(
  'docs/integration-packages/microsoft-teams#setup',
);

type DocsImportMeta = ImportMeta & {
  env?: {
    VITE_DOCS_URL?: string;
  };
};

function getDocsUrl(path: string) {
  const baseUrl = (
    (import.meta as DocsImportMeta).env?.VITE_DOCS_URL || DEFAULT_DOCS_URL
  )
    .trim()
    .replace(/\/+$/, '');
  return `${baseUrl}/${path.replace(/^\/+/, '')}`;
}

export function TeamsSettingsModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { auth, store } = useIntegrationHost();
  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [connected, setConnected] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const cleanupRef = useRef<(() => void) | null>(null);
  const callbackUrl = `${window.location.origin}/oauth/callback/microsoft-teams`;

  useEffect(() => {
    let active = true;
    setError('');
    setConnected(false);
    setPending(false);
    if (isOpen && auth.currentUser) {
      void store
        .getIntegration(auth.currentUser.uid, 'microsoft-teams')
        .then((connection) => {
          if (active)
            setConnected(Boolean(connection?.credentialStatus.configured));
        })
        .catch(() => {
          if (active) setError('Unable to load your Teams connection.');
        });
    }
    return () => {
      active = false;
      cleanupRef.current?.();
      cleanupRef.current = null;
      setClientSecret('');
      setClientId('');
      setTenantId('');
    };
  }, [auth, isOpen, store]);

  const authenticate = async () => {
    if (!auth.currentUser || pending) return;
    setError('');
    setPending(true);
    // Open synchronously so browsers do not block the popup after PKCE hashing.
    const popup = window.open(
      'about:blank',
      'PlayrunnerTeamsOAuth',
      'width=520,height=720',
    );
    if (!popup) {
      setPending(false);
      setError('Allow popups to connect Microsoft Teams.');
      return;
    }
    const controller = new AbortController();
    let disposed = false;
    let received = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let listener: ((event: MessageEvent) => void) | undefined;
    const cleanup = () => {
      disposed = true;
      controller.abort();
      if (timer) clearInterval(timer);
      if (listener) window.removeEventListener('message', listener);
      popup.close();
    };
    cleanupRef.current = cleanup;
    try {
      const authorization = await createTeamsAuthorization({
        tenantId: tenantId.trim(),
        clientId: clientId.trim(),
        redirectUri: callbackUrl,
      });
      if (disposed) return;
      listener = (event) => {
        if (
          received ||
          !isTeamsCallback(
            event,
            popup,
            authorization.state,
            window.location.origin,
          )
        )
          return;
        received = true;
        if (timer) clearInterval(timer);
        void (async () => {
          try {
            if (event.data.params.error || !event.data.params.code)
              throw new Error(
                'Microsoft Teams authorization was not completed.',
              );
            const token = await auth.currentUser?.getIdToken();
            if (disposed) return;
            const response = await fetch('/api/microsoft-teams/oauth-token', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              signal: controller.signal,
              body: JSON.stringify({
                tenantId: tenantId.trim(),
                clientId: clientId.trim(),
                clientSecret,
                redirectUri: callbackUrl,
                code: event.data.params.code,
                codeVerifier: authorization.verifier,
              }),
            });
            const data = await response.json();
            if (!response.ok || !data.connected)
              throw new Error(
                'Unable to connect Microsoft Teams. Check the app credentials, redirect URL, and permissions.',
              );
            if (!disposed) {
              setConnected(true);
              setClientSecret('');
            }
          } catch (failure) {
            if (!disposed)
              setError(
                failure instanceof Error &&
                  failure.message.startsWith('Microsoft Teams authorization')
                  ? failure.message
                  : 'Unable to connect Microsoft Teams. Check the app credentials, redirect URL, and permissions.',
              );
          } finally {
            if (!disposed) setPending(false);
            cleanup();
          }
        })();
      };
      window.addEventListener('message', listener);
      const deadline = Date.now() + 5 * 60_000;
      timer = setInterval(() => {
        if (popup.closed || Date.now() > deadline) {
          setPending(false);
          setError('Microsoft Teams authorization was cancelled or timed out.');
          cleanup();
        }
      }, 500);
      popup.location.href = authorization.url;
    } catch {
      if (!disposed) {
        setPending(false);
        setError('Unable to start Microsoft Teams authorization.');
      }
      cleanup();
    }
  };

  const disconnect = async () => {
    if (!auth.currentUser) return;
    try {
      await store.deleteIntegration(auth.currentUser.uid, 'microsoft-teams');
      setConnected(false);
      setClientSecret('');
      setError('');
    } catch {
      setError('Unable to disconnect Microsoft Teams. Try again.');
    }
  };

  return (
    <>
      <IntegrationSettingsModal
        isOpen={isOpen}
        onClose={onClose}
        title="Connect to Microsoft Teams"
        icon={
          <img
            src={teamsIconUrl}
            alt="Microsoft Teams"
            className="h-5 w-5 object-contain"
          />
        }
        isConnected={connected}
        connectedTitle="Microsoft Teams Connected Successfully"
        connectedDescription={
          error ||
          'Your work or school account is ready to send channel messages.'
        }
        onChangeCredentials={() => {
          setConnected(false);
          setError('');
        }}
        onDisconnect={disconnect}
        primaryActionLabel="Connect Microsoft Teams"
        primaryActionPendingLabel="Connecting..."
        primaryActionPending={pending}
        primaryActionDisabled={
          !/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(tenantId.trim()) ||
          !clientId.trim() ||
          !clientSecret.trim()
        }
        onPrimaryAction={authenticate}
      >
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] p-4 text-left">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--background)]">
              <BookOpen aria-hidden="true" className="h-4 w-4 text-muted" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--foreground)]">
                Microsoft Teams setup
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Register an Entra application with a Web redirect URL below. Add
                delegated Team.ReadBasic.All, Channel.ReadBasic.All, and
                ChannelMessage.Send permissions. Sign in with a work or school
                account; tenant policy may require administrator consent.
              </p>
              <a
                href={TEAMS_SETUP_DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--foreground)] underline underline-offset-4 hover:text-muted"
              >
                Open Microsoft Teams setup guide
                <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted">Web redirect URL</p>
          <IntegrationCopyableCode value={callbackUrl} />
        </div>
        <IntegrationConfigField label="Tenant ID or domain">
          <IntegrationConnectionInput
            connectionId="microsoft-teams"
            fieldSlot="a"
            aria-label="Tenant ID or domain"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="Directory tenant ID or contoso.onmicrosoft.com"
            disabled={pending}
          />
        </IntegrationConfigField>
        <IntegrationConfigField label="Application ID">
          <IntegrationConnectionInput
            connectionId="microsoft-teams"
            fieldSlot="b"
            aria-label="Application ID"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Application (client) ID"
            disabled={pending}
          />
        </IntegrationConfigField>
        <IntegrationConfigField label="Client secret">
          <IntegrationConnectionInput
            connectionId="microsoft-teams"
            fieldSlot="c"
            aria-label="Client secret"
            mode="secret"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="Client secret value"
            disabled={pending}
          />
        </IntegrationConfigField>
        {error && (
          <p role="alert" className="text-sm text-muted">
            {error}
          </p>
        )}
      </IntegrationSettingsModal>
    </>
  );
}
