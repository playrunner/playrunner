import React, { useState } from 'react';
import { Check, ChevronRight, Loader2, Copy } from 'lucide-react';
import { Input } from '../../components/ui/Input';
import { auth } from '../../lib/auth';
import { DbAPI } from '../../lib/db';
import { Modal } from '../../components/ui/Modal';

interface GithubSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function GithubSettingsModal({
  isOpen,
  onClose,
}: GithubSettingsModalProps) {
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
          const data = await DbAPI.getIntegration(
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
  }, [isOpen]);

  const handleAuthenticateGithub = async () => {
    try {
      setIsAuthenticating(true);

      if (auth.currentUser) {
        await DbAPI.saveIntegration(auth.currentUser.uid, 'github', {
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

                await DbAPI.saveIntegration(
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
      await DbAPI.deleteIntegration(auth.currentUser.uid, 'github');
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
      icon={
        <div
          className="w-5 h-5 bg-[var(--foreground)]"
          style={{
            WebkitMaskImage: 'url(/images/integrations/github.svg)',
            WebkitMaskSize: 'contain',
            WebkitMaskRepeat: 'no-repeat',
            WebkitMaskPosition: 'center',
            maskImage: 'url(/images/integrations/github.svg)',
            maskSize: 'contain',
            maskRepeat: 'no-repeat',
            maskPosition: 'center',
          }}
        />
      }
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
              <span className="text-muted text-xs">•</span>
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
          <ol className="list-decimal pl-4 space-y-3 text-sm text-[var(--foreground)]">
            <li>
              Go to your{' '}
              <a
                href="https://github.com/settings/apps"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 hover:underline"
              >
                GitHub Developer Settings
              </a>
              .
            </li>
            <li>
              Click <strong>New GitHub App</strong>.
            </li>
            <li>
              Under <strong>Basic information</strong>, give your app a{' '}
              <strong>GitHub App Name</strong> (this becomes your app slug) and
              set a <strong>Homepage URL</strong>.
            </li>
            <li>
              Under <strong>Identifying and authorizing users</strong>, add the
              following callback URL:
              <div className="relative mt-2">
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
              <p className="mt-2 text-xs text-blue-400 font-medium">
                IMPORTANT: You must check "Request user authorization (OAuth)
                during installation" just below the callback URL.
              </p>
            </li>
            <li>
              Under <strong>Post installation</strong>, set the{' '}
              <strong>Setup URL</strong> to the exact same URL as above.
              <br />
              Check the box for <strong>Redirect on update</strong>.
            </li>
            <li>
              Under <strong>Webhook</strong>, uncheck <strong>Active</strong>.
            </li>
            <li>
              Under <strong>Repository permissions</strong>, set{' '}
              <strong>Contents</strong> to <strong>Read and write</strong>.
            </li>
            <li>
              Under <strong>Where can this GitHub App be installed?</strong>,
              select:
              <ul className="list-disc pl-4 mt-2 space-y-1 text-muted">
                <li>
                  <strong>Only on this account:</strong> If only you will use
                  this app with your repositories.
                </li>
                <li>
                  <strong>Any account:</strong> If you plan to let other users
                  connect their own GitHub accounts and use this app with their
                  repositories.
                </li>
              </ul>
            </li>
            <li>
              Click <strong>Create GitHub App</strong>.
            </li>
            <li>
              Generate a new <strong>Client Secret</strong>.
            </li>
            <li>
              Copy and paste the App Name, Client ID, and Secret below. You can
              decide which repositories to install it on in the next step.
            </li>
          </ol>

          <div className="space-y-4 pt-2 border-t border-subtle">
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">
                GitHub App Name (URL Slug)
              </label>
              <Input
                placeholder="e.g. my-awesome-app"
                value={githubAppName}
                onChange={(e) => setGithubAppName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">
                Client ID
              </label>
              <Input
                placeholder="Enter GitHub App Client ID"
                value={githubClientId}
                onChange={(e) => setGithubClientId(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">
                Client Secret
              </label>
              <Input
                type="password"
                placeholder="Enter GitHub App Client Secret"
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
