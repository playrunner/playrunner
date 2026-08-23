import React, { useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
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

type GithubConnectionStatus = {
  appSlug: string;
  connected: boolean;
  contents: string;
  installationFound: boolean;
  missingPermissions: string[];
  pullRequests: string;
  reauthorizationRequired: boolean;
};

const DEFAULT_DOCS_URL = 'https://playrunner.dev';
const GITHUB_SETUP_DOCS_URL = getDocsUrl(
  'docs/integration-packages/github#setup',
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

export function GithubSettingsModal({
  isOpen,
  onClose,
}: GithubSettingsModalProps) {
  const { auth, store, ui } = useIntegrationHost();
  const Modal = ui.Modal;
  const Button = ui.Button;
  const [githubAppName, setGithubAppName] = useState('');
  const [githubClientId, setGithubClientId] = useState('');
  const [githubClientSecret, setGithubClientSecret] = useState('');
  const [githubAppSlug, setGithubAppSlug] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authSuccess, setAuthSuccess] = useState(false);
  const [authError, setAuthError] = useState('');
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [connectionStatus, setConnectionStatus] =
    useState<GithubConnectionStatus | null>(null);
  const [isCheckingConnection, setIsCheckingConnection] = useState(false);
  const popupRef = React.useRef<Window | null>(null);

  const callbackUrl = `${window.location.origin}/oauth/callback/github`;

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(callbackUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const fetchConnectionStatus = React.useCallback(async () => {
    if (!auth.currentUser) return;
    setIsCheckingConnection(true);
    try {
      const token = await auth.currentUser.getIdToken();
      const response = await fetch('/api/github/connection-status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await response.json()) as GithubConnectionStatus & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || 'GitHub connection check failed.');
      }
      setAuthError('');
      setConnectionStatus(data);
      setGithubAppSlug(data.appSlug || null);
    } catch (error) {
      console.error('Failed to inspect GitHub connection:', error);
      setConnectionStatus(null);
      setAuthError(
        'Playrunner could not verify the GitHub App permissions. Reauthorize GitHub before running workflows that create pull requests.',
      );
    } finally {
      setIsCheckingConnection(false);
    }
  }, [auth]);

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
            const appName =
              typeof data.config?.appName === 'string'
                ? data.config.appName
                : typeof data.config?.appSlug === 'string'
                  ? data.config.appSlug
                  : '';
            const appSlug =
              typeof data.config?.appSlug === 'string'
                ? data.config.appSlug
                : null;
            setGithubAppName(appName);
            setGithubAppSlug(appSlug);
            setAuthSuccess(Boolean(data.credentialStatus?.configured));
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
      setAuthError('');
      setIsAuthenticating(false);
      setGithubAppName('');
      setGithubClientId('');
      setGithubClientSecret('');
      setGithubAppSlug(null);
      setConnectionStatus(null);
    }

    return () => {
      isMounted = false;
    };
  }, [auth, isOpen, store]);

  React.useEffect(() => {
    if (isOpen && authSuccess) void fetchConnectionStatus();
  }, [authSuccess, fetchConnectionStatus, isOpen]);

  const handleAuthenticateGithub = async () => {
    try {
      setIsAuthenticating(true);
      setAuthError('');

      let isProcessing = false;
      let installationId: string | undefined;
      const oauthState = crypto.randomUUID();
      const messageListener = async (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type === 'oauth_callback' && event.data?.success) {
          if (isProcessing) return;
          isProcessing = true;

          let didConnect = false;
          if (auth.currentUser) {
            if (event.data?.params?.code) {
              try {
                if (event.data.params.state !== oauthState) {
                  throw new Error(
                    'GitHub returned an invalid OAuth state. Try connecting again.',
                  );
                }
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
                    app_name: githubAppName,
                    installation_id:
                      event.data.params.installation_id || installationId,
                  }),
                });

                const tokenData = await tokenRes.json();

                if (!tokenRes.ok || !tokenData.connected) {
                  throw new Error(
                    `Failed to retrieve access token: ${JSON.stringify(tokenData)}`,
                  );
                }

                setGithubAppSlug(githubAppName);
                didConnect = true;
                if (popupRef.current)
                  popupRef.current.postMessage(
                    { type: 'oauth_close' },
                    window.location.origin,
                  );
              } catch (err) {
                console.error('Failed to save auth code:', err);
                setAuthError(
                  err instanceof Error
                    ? err.message
                    : 'Failed to save the GitHub connection.',
                );
                if (popupRef.current)
                  popupRef.current.postMessage(
                    { type: 'oauth_close' },
                    window.location.origin,
                  );
              }
            } else if (event.data?.params?.installation_id) {
              installationId = event.data.params.installation_id;
              const authorizeUrl = new URL(
                'https://github.com/login/oauth/authorize',
              );
              authorizeUrl.searchParams.set('client_id', githubClientId);
              authorizeUrl.searchParams.set('redirect_uri', callbackUrl);
              authorizeUrl.searchParams.set('state', oauthState);
              popupRef.current?.postMessage(
                {
                  type: 'oauth_install_redirect',
                  url: authorizeUrl.toString(),
                },
                window.location.origin,
              );
              isProcessing = false;
              return;
            } else {
              setAuthError(
                'GitHub returned no OAuth code. Check the GitHub App callback and OAuth settings, then try again.',
              );
            }
          } else {
            setAuthError('You must be signed in to connect GitHub.');
          }

          setIsAuthenticating(false);
          setAuthSuccess(didConnect);
          window.removeEventListener('message', messageListener);
        }
      };

      window.addEventListener('message', messageListener);

      const installationUrl = new URL(
        `https://github.com/apps/${githubAppName}/installations/new`,
      );
      installationUrl.searchParams.set('state', oauthState);

      const width = 800;
      const height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      popupRef.current = window.open(
        installationUrl.toString(),
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
      setAuthError(
        error instanceof Error
          ? error.message
          : 'Failed to authenticate with GitHub.',
      );
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
      setConnectionStatus(null);
    } catch (error) {
      console.error('Failed to disconnect Github', error);
    }
  };

  const handleReauthorizeGithub = async () => {
    if (!auth.currentUser) {
      setAuthError('You must be signed in to reauthorize GitHub.');
      return;
    }
    setIsAuthenticating(true);
    setAuthError('');
    const oauthState = crypto.randomUUID();
    popupRef.current = window.open(
      'about:blank',
      'GithubOAuth',
      'toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width=800, height=700',
    );
    if (!popupRef.current) {
      setAuthError(
        'The GitHub authorization window was blocked. Allow popups for Playrunner and try again.',
      );
      setIsAuthenticating(false);
      return;
    }
    let isProcessing = false;
    const messageListener = async (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.data?.type !== 'oauth_callback' ||
        !event.data?.success ||
        isProcessing
      ) {
        return;
      }
      isProcessing = true;
      try {
        if (
          event.data?.params?.state !== oauthState ||
          !event.data?.params?.code
        ) {
          throw new Error(
            'GitHub returned an invalid authorization response. Try reauthorizing again.',
          );
        }
        const token = await auth.currentUser!.getIdToken();
        const response = await fetch('/api/github/reauthorize', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ code: event.data.params.code }),
        });
        const data = (await response.json()) as {
          connected?: boolean;
          error?: string;
        };
        if (!response.ok || !data.connected) {
          throw new Error(data.error || 'GitHub reauthorization failed.');
        }
        popupRef.current?.postMessage(
          { type: 'oauth_close' },
          window.location.origin,
        );
        await fetchConnectionStatus();
      } catch (error) {
        setAuthError(
          error instanceof Error
            ? error.message
            : 'Failed to reauthorize GitHub.',
        );
      } finally {
        setIsAuthenticating(false);
        window.removeEventListener('message', messageListener);
      }
    };
    window.addEventListener('message', messageListener);
    try {
      const token = await auth.currentUser.getIdToken();
      const response = await fetch('/api/github/reauthorize-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ callbackUrl, state: oauthState }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        authorizeUrl?: string;
        error?: string;
      };
      if (!response.ok || !data.authorizeUrl) {
        throw new Error(
          response.status === 404
            ? 'GitHub reauthorization is not loaded. Restart the Playrunner API and try again.'
            : data.error || 'Failed to start GitHub reauthorization.',
        );
      }
      popupRef.current.location.href = data.authorizeUrl;
    } catch (error) {
      popupRef.current?.close();
      window.removeEventListener('message', messageListener);
      setAuthError(
        error instanceof Error
          ? error.message
          : 'Failed to start GitHub reauthorization.',
      );
      setIsAuthenticating(false);
      return;
    }
    const checkPopup = setInterval(() => {
      if (!popupRef.current || popupRef.current.closed) {
        clearInterval(checkPopup);
        setIsAuthenticating(false);
        window.removeEventListener('message', messageListener);
      }
    }, 500);
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
          <div
            className={`w-16 h-16 rounded-full flex items-center justify-center animate-in zoom-in duration-300 ${
              connectionStatus?.reauthorizationRequired
                ? 'bg-amber-500/20'
                : 'bg-green-500/20'
            }`}
          >
            {connectionStatus?.reauthorizationRequired ? (
              <AlertTriangle className="w-8 h-8 text-amber-500" />
            ) : (
              <Check className="w-8 h-8 text-green-500" />
            )}
          </div>
          <div>
            <h3 className="text-xl font-semibold text-[var(--foreground)] mb-2">
              {connectionStatus?.reauthorizationRequired
                ? 'GitHub needs reauthorization'
                : 'GitHub Connected Successfully'}
            </h3>
            <p className="text-muted text-sm max-w-[320px] mx-auto mb-4">
              {connectionStatus?.reauthorizationRequired
                ? 'The installed GitHub App does not have every permission required to create bot branches and draft pull requests.'
                : 'Your GitHub App is connected. You can now use it to manage your repositories.'}
            </p>

            {authError ? (
              <div
                role="alert"
                className="mb-4 max-w-sm rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-left text-sm text-red-500"
              >
                {authError}
              </div>
            ) : null}

            {connectionStatus?.reauthorizationRequired ? (
              <div className="mb-4 max-w-sm rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-left text-sm text-amber-500">
                Approve Contents and Pull requests read/write permissions for
                the GitHub App installation, then reauthorize this connection.
              </div>
            ) : null}

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

            {Button ? (
              <Button
                type="button"
                variant="primary"
                onClick={handleReauthorizeGithub}
                disabled={isAuthenticating || isCheckingConnection}
                className="mb-6 gap-2"
              >
                {isAuthenticating || isCheckingConnection ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Reauthorize GitHub
              </Button>
            ) : (
              <button
                type="button"
                onClick={handleReauthorizeGithub}
                disabled={isAuthenticating || isCheckingConnection}
                className="mb-6 inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] shadow-sm transition-colors hover:bg-[var(--accent-hover)] disabled:pointer-events-none disabled:opacity-50"
              >
                {isAuthenticating || isCheckingConnection ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Reauthorize GitHub
              </button>
            )}

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

          {authError ? (
            <div
              role="alert"
              className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-500"
            >
              {authError}
            </div>
          ) : null}

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
                  repository permissions (Issues and Pull requests: Read and
                  write; Contents: Read and write), and find the app slug,
                  client ID, and client secret. Install the app on each source
                  repository where Playrunner should create bot branches and
                  draft pull requests. Private repositories are supported.
                  Configure workflows to withhold deployment and production
                  secrets from branches under playrunner/tests/. Generated-test
                  delivery rejects source workflows using pull_request_target,
                  workflow_run, self-hosted/custom runner labels, runner groups,
                  dynamic runner expressions, or reusable-workflow indirection.
                  Use static standard GitHub-hosted runners for bot PR checks.
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
