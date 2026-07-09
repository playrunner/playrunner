import React, { useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import {
  IntegrationConnectionAutofillGuard,
  IntegrationConnectionInput,
  useIntegrationHost,
} from '@playrunner/integration-sdk';
import { GithubIcon } from './GithubIcon';

interface GithubSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_DOCS_URL = 'https://docs.playrunner.dev';
const GITHUB_SETUP_DOCS_URL = getDocsUrl('docs/tutorials/connect-github');

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

export function GithubSettingsModal({
  isOpen,
  onClose,
}: GithubSettingsModalProps) {
  const { auth, store, ui } = useIntegrationHost();
  const Modal = ui.Modal;
  const [githubAppName, setGithubAppName] = useState('');
  const [githubClientId, setGithubClientId] = useState('');
  const [githubClientSecret, setGithubClientSecret] = useState('');
  const [githubAppSlug, setGithubAppSlug] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authSuccess, setAuthSuccess] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const popupRef = React.useRef<Window | null>(null);

  const callbackUrl = `${window.location.origin}/oauth/callback/github`;

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(callbackUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  React.useEffect(() => {
    let isMounted = true;
    const fetchCredentials = async () => {
      if (isOpen && auth.currentUser) {
        try {
          const data = await store.getIntegration(
            auth.currentUser.uid,
            'github',
          );
          if (data && isMounted) {
            if (data.clientId && data.accessToken) {
              setGithubAppName(data.appName || data.appSlug || '');
              setGithubClientId(data.clientId);
              setGithubClientSecret(data.clientSecret || '');
              if (data.appSlug) setGithubAppSlug(data.appSlug);
              setAuthSuccess(true);
            } else if (data.clientId) {
              setGithubAppName(data.appName || data.appSlug || '');
              setGithubClientId(data.clientId);
              setGithubClientSecret(data.clientSecret || '');
              if (data.appSlug) setGithubAppSlug(data.appSlug);
            }
          }
        } catch (error) {
          console.error('Failed to fetch Github credentials', error);
        }
      }
    };

    if (isOpen) {
      fetchCredentials();
    } else {
      setAuthSuccess(false);
      setIsAuthenticating(false);
      setGithubAppName('');
      setGithubClientId('');
      setGithubClientSecret('');
      setGithubAppSlug(null);
    }

    return () => {
      isMounted = false;
    };
  }, [auth, isOpen, store]);

  const handleAuthenticateGithub = async () => {
    try {
      setIsAuthenticating(true);

      const currentUser = auth.currentUser;

      if (currentUser) {
        await store.saveIntegration(currentUser.uid, 'github', {
          appName: githubAppName,
          clientId: githubClientId,
          clientSecret: githubClientSecret,
          updatedAt: new Date().toISOString(),
        });
      }

      let isProcessing = false;
      const messageListener = async (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type === 'oauth_callback' && event.data?.success) {
          if (isProcessing) return;
          isProcessing = true;

          if (auth.currentUser) {
            if (event.data?.params?.code) {
              try {
                // Exchange the code for an access token
                const token = await auth.currentUser.getIdToken();
                const tokenRes = await fetch('/api/github/token', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({
                    code: event.data.params.code,
                    client_id: githubClientId,
                    client_secret: githubClientSecret,
                  }),
                });

                const tokenData = await tokenRes.json();

                if (!tokenData.access_token) {
                  throw new Error(
                    `Failed to retrieve access token: ${JSON.stringify(tokenData)}`,
                  );
                }

                const integrationData: any = {
                  appName: githubAppName,
                  clientId: githubClientId,
                  clientSecret: githubClientSecret,
                  code: event.data.params.code,
                  accessToken: tokenData.access_token,
                  refreshToken: tokenData.refresh_token,
                  expiresAt: tokenData.expires_in
                    ? Date.now() + tokenData.expires_in * 1000
                    : undefined,
                  refreshTokenExpiresAt: tokenData.refresh_token_expires_in
                    ? Date.now() + tokenData.refresh_token_expires_in * 1000
                    : undefined,
                  appSlug: githubAppName,
                  updatedAt: new Date().toISOString(),
                };

                // Store installation_id if it was provided
                if (event.data.params.installation_id) {
                  integrationData.installationId =
                    event.data.params.installation_id;
                }

                await store.saveIntegration(
                  auth.currentUser.uid,
                  'github',
                  integrationData,
                );

                setGithubAppSlug(githubAppName);
                if (popupRef.current)
                  popupRef.current.postMessage(
                    { type: 'oauth_close' },
                    window.location.origin,
                  );
              } catch (err) {
                console.error('Failed to save auth code:', err);
                if (popupRef.current)
                  popupRef.current.postMessage(
                    { type: 'oauth_close' },
                    window.location.origin,
                  );
              }
            } else if (event.data?.params?.installation_id) {
              if (event.data?.params?.setup_action === 'update') {
                // Just an update to the installation (e.g. adding repositories)
                if (popupRef.current)
                  popupRef.current.postMessage(
                    { type: 'oauth_close' },
                    window.location.origin,
                  );
              } else {
                // If there is an installation ID but no code, they probably forgot to check "Request user authorization (OAuth) during installation"
                alert(
                  "Installation successful, but no OAuth code found. Please ensure you checked 'Request user authorization (OAuth) during installation' in your GitHub App settings.",
                );
                if (popupRef.current)
                  popupRef.current.postMessage(
                    { type: 'oauth_close' },
                    window.location.origin,
                  );
              }
            }
          }

          setIsAuthenticating(false);
          setAuthSuccess(true);
          window.removeEventListener('message', messageListener);
        }
      };

      window.addEventListener('message', messageListener);

      const authUrl = `https://github.com/apps/${githubAppName}/installations/new`;

      const width = 800;
      const height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      popupRef.current = window.open(
        authUrl,
        'GithubOAuth',
        `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width=${width}, height=${height}, top=${top}, left=${left}`,
      );

      const checkPopup = setInterval(() => {
        if (!popupRef.current || popupRef.current.closed) {
          clearInterval(checkPopup);
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
      await store.deleteIntegration(auth.currentUser.uid, 'github');
      setAuthSuccess(false);
      setGithubAppName('');
      setGithubClientId('');
      setGithubClientSecret('');
      setGithubAppSlug(null);
    } catch (error) {
      console.error('Failed to disconnect Github', error);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      zIndex={70}
      title="Connect to GitHub"
      icon={<GithubIcon className="w-5 h-5 text-[var(--foreground)]" />}
      footer={
        !authSuccess ? (
          <button
            onClick={handleAuthenticateGithub}
            disabled={
              !githubAppName ||
              !githubClientId ||
              !githubClientSecret ||
              isAuthenticating
            }
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-[var(--accent-foreground)] font-medium text-sm transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isAuthenticating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Authenticating...
              </>
            ) : (
              <>
                Authenticate
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </button>
        ) : null
      }
    >
      {authSuccess ? (
        <div className="flex flex-col items-center justify-center text-center gap-4 py-8">
          <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center animate-in zoom-in duration-300">
            <Check className="w-8 h-8 text-green-500" />
          </div>
          <div>
            <h3 className="text-xl font-semibold text-[var(--foreground)] mb-2">
              GitHub Connected Successfully
            </h3>
            <p className="text-muted text-sm max-w-[320px] mx-auto mb-4">
              Your GitHub App is connected. You can now use it to manage your
              repositories.
            </p>

            <div className="bg-[var(--control-bg)] border border-[var(--border)] rounded-lg p-4 text-left max-w-sm mx-auto mb-6">
              <h4 className="text-sm font-medium text-[var(--foreground)] mb-2">
                Manage Repositories
              </h4>

              <div className="space-y-3 text-xs text-muted">
                <p>
                  You can change which repositories the app has access to at any
                  time.
                </p>
                {githubAppSlug && (
                  <a
                    href={`https://github.com/apps/${githubAppSlug}/installations/new`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex justify-center items-center gap-2 px-3 py-2 mt-2 w-full rounded-md bg-[var(--foreground)] text-[var(--background)] hover:bg-[var(--foreground)]/90 font-medium transition-colors"
                  >
                    Configure App Repositories
                  </a>
                )}
              </div>
            </div>

            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() => setAuthSuccess(false)}
                className="text-xs text-muted hover:text-[var(--foreground)] underline transition-colors"
              >
                Change Credentials
              </button>
              <span className="text-muted text-xs">/</span>
              <button
                onClick={handleDisconnect}
                className="text-xs text-red-500 hover:text-red-400 underline transition-colors"
              >
                Disconnect
              </button>
            </div>
          </div>
          <button
            onClick={onClose}
            className="mt-4 flex items-center gap-2 px-4 py-2 rounded-lg bg-surface border border-subtle hover:bg-surface-hover text-[var(--foreground)] font-medium text-sm transition-colors shadow-sm"
          >
            Close Menu
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <IntegrationConnectionAutofillGuard connectionId="github" />

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] p-4 text-left">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--background)]">
                <BookOpen className="h-4 w-4 text-muted" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--foreground)]">
                  GitHub App setup
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  Use the setup guide to create the GitHub App, configure
                  repository permissions, and find the app slug, client ID, and
                  client secret.
                </p>
                <a
                  href={GITHUB_SETUP_DOCS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--foreground)] underline underline-offset-4 hover:text-muted"
                >
                  Open GitHub setup guide
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted">Callback URL</p>
            <p className="text-xs leading-relaxed text-muted">
              Use this value when the setup guide asks for the callback URL and
              setup URL.
            </p>
            <div className="relative">
              <code className="block p-3 pr-10 bg-[var(--background)] border border-subtle rounded text-xs select-all font-mono text-blue-400 overflow-x-auto whitespace-nowrap">
                {callbackUrl}
              </code>
              <button
                type="button"
                onClick={handleCopyUrl}
                className="absolute top-2 right-2 p-1 rounded bg-[var(--background)] text-muted hover:text-[var(--foreground)] hover:bg-surface-hover transition-colors"
                title="Copy URL"
              >
                {copiedUrl ? (
                  <Check className="w-3.5 h-3.5 text-green-500" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          <div className="space-y-4 pt-2 border-t border-subtle">
            <div>
              <label
                htmlFor="github-connection-field-a"
                className="block text-xs font-medium text-muted mb-1.5"
              >
                GitHub App Name (URL Slug)
              </label>
              <IntegrationConnectionInput
                id="github-connection-field-a"
                connectionId="github"
                fieldSlot="a"
                placeholder="e.g. my-awesome-app"
                value={githubAppName}
                onChange={(e) => setGithubAppName(e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="github-connection-field-b"
                className="block text-xs font-medium text-muted mb-1.5"
              >
                Client ID
              </label>
              <IntegrationConnectionInput
                id="github-connection-field-b"
                connectionId="github"
                fieldSlot="b"
                placeholder="Paste value from GitHub app"
                value={githubClientId}
                onChange={(e) => setGithubClientId(e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="github-connection-field-c"
                className="block text-xs font-medium text-muted mb-1.5"
              >
                Client Secret
              </label>
              <IntegrationConnectionInput
                id="github-connection-field-c"
                connectionId="github"
                fieldSlot="c"
                mode="secret"
                placeholder="Paste value from GitHub app"
                value={githubClientSecret}
                onChange={(e) => setGithubClientSecret(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
