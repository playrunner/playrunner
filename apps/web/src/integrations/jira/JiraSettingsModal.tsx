import React, { useState } from "react";
import { Check, ChevronRight, Loader2, Copy } from "lucide-react";
import { Input } from "../../components/ui/Input";
import { auth } from "../../lib/auth";
import { DbAPI } from "../../lib/db";
import { Modal } from "../../components/ui/Modal";

interface JiraSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function JiraSettingsModal({ isOpen, onClose }: JiraSettingsModalProps) {
  const [jiraClientId, setJiraClientId] = useState("");
  const [jiraClientSecret, setJiraClientSecret] = useState("");
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authSuccess, setAuthSuccess] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const popupRef = React.useRef<Window | null>(null);

  const callbackUrl = `${window.location.origin}/oauth/callback/jira`;

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
          const data = await DbAPI.getIntegration(auth.currentUser.uid, "jira");
          if (data && isMounted) {
            if (data.clientId && data.accessToken) {
              setJiraClientId(data.clientId);
              setJiraClientSecret(data.clientSecret || "");
              setAuthSuccess(true);
            } else if (data.clientId) {
              setJiraClientId(data.clientId);
              setJiraClientSecret(data.clientSecret || "");
            }
          }
        } catch (error) {
          console.error("Failed to fetch Jira credentials", error);
        }
      }
    };
    
    if (isOpen) {
      fetchCredentials();
    } else {
      setAuthSuccess(false);
      setIsAuthenticating(false);
      setJiraClientId("");
      setJiraClientSecret("");
    }
    
    return () => { isMounted = false; };
  }, [isOpen]);

  const handleAuthenticateJira = async () => {
    try {
      setIsAuthenticating(true);

      if (auth.currentUser) {
        await DbAPI.saveIntegration(auth.currentUser.uid, "jira", {
          clientId: jiraClientId,
          clientSecret: jiraClientSecret,
          updatedAt: new Date().toISOString()
        });
      }

      const messageListener = async (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type === 'oauth_callback') {
          window.removeEventListener('message', messageListener); // Remove early to prevent double-fire
          
          if (event.data?.success && auth.currentUser && event.data?.params?.code) {
              try {
                const token = await auth.currentUser.getIdToken();
                const tokenRes = await fetch("/api/jira/token", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                  },
                  body: JSON.stringify({
                    code: event.data.params.code,
                    client_id: jiraClientId,
                    client_secret: jiraClientSecret,
                    redirect_uri: callbackUrl
                  })
                });

                const tokenData = await tokenRes.json();
                
                if (!tokenRes.ok || !tokenData.access_token) {
                   throw new Error(`Failed to retrieve access token: ${JSON.stringify(tokenData)}`);
                }

                await DbAPI.saveIntegration(auth.currentUser.uid, "jira", {
                   clientId: jiraClientId,
                   clientSecret: jiraClientSecret,
                   code: event.data.params.code,
                   accessToken: tokenData.access_token,
                   refreshToken: tokenData.refresh_token,
                   expiresAt: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : undefined,
                   updatedAt: new Date().toISOString()
                });
                
                setIsAuthenticating(false);
                setAuthSuccess(true);
                if (popupRef.current) popupRef.current.postMessage({ type: 'oauth_close' }, window.location.origin);
             } catch(err: any) {
                console.error("Failed to save auth code:", err);
                setIsAuthenticating(false);
                alert(`Failed to authenticate with Jira. Details: ${err.message}`);
                if (popupRef.current) popupRef.current.postMessage({ type: 'oauth_close' }, window.location.origin);
             }
          } else {
             setIsAuthenticating(false);
             if (popupRef.current) popupRef.current.postMessage({ type: 'oauth_close' }, window.location.origin);
          }
        }
      };
      
      window.addEventListener('message', messageListener);

      const redirectUri = encodeURIComponent(`${window.location.origin}/oauth/callback/jira`);
      const authUrl = `https://auth.atlassian.com/authorize?audience=api.atlassian.com&client_id=${jiraClientId}&scope=read:jira-work%20write:jira-work%20offline_access&redirect_uri=${redirectUri}&state=123&response_type=code&prompt=consent`;
      
      const width = 500;
      const height = 600;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      popupRef.current = window.open(
        authUrl, 
        'JiraOAuth', 
        `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width=${width}, height=${height}, top=${top}, left=${left}`
      );
      
      const checkPopup = setInterval(() => {
        if (!popupRef.current || popupRef.current.closed) {
          clearInterval(checkPopup);
          setIsAuthenticating(false);
          window.removeEventListener('message', messageListener);
        }
      }, 500);
      
    } catch (error) {
      console.error("Failed to save credentials", error);
      setIsAuthenticating(false);
    }
  };

  const handleDisconnect = async () => {
    if (!auth.currentUser) return;
    try {
      await DbAPI.deleteIntegration(auth.currentUser.uid, "jira");
      setAuthSuccess(false);
      setJiraClientId("");
      setJiraClientSecret("");
    } catch (error) {
      console.error("Failed to disconnect Jira", error);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      zIndex={70}
      title="Connect to Jira"
      icon={<img src="/images/integrations/jira.svg" alt="Jira" className="w-5 h-5 object-contain" />}
      footer={
        !authSuccess ? (
          <button 
            onClick={handleAuthenticateJira}
            disabled={!jiraClientId || !jiraClientSecret || isAuthenticating}
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
            <h3 className="text-xl font-semibold text-[var(--foreground)] mb-2">Jira Connected Successfully</h3>
            <p className="text-muted text-sm max-w-[280px] mx-auto mb-4">
              Your Jira workspace has been securely linked and is ready to use.
            </p>
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
              Go to the <a href="https://developer.atlassian.com/console/myapps/" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline">Atlassian Developer Console</a>.
            </li>
            <li>
              Click <strong>Create</strong> and select <strong>OAuth 2.0 integration</strong>.
            </li>
            <li>
              Give your app a name and agree to the terms, then click <strong>Create</strong>.
            </li>
            <li>
              In the left menu, select <strong>Permissions</strong> and add the Jira API. Grant <code>read:jira-work</code> and <code>write:jira-work</code> scopes.
            </li>
            <li>
              In the left menu, select <strong>Authorization</strong>. Add the following callback URL:
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
                  {copiedUrl ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </li>
            <li>
              Go back to <strong>Settings</strong> to find your <strong>Client ID</strong> and <strong>Secret</strong>.
            </li>
            <li>
              Copy and paste them below.
            </li>
          </ol>

          <div className="space-y-4 pt-2 border-t border-subtle">
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Client ID</label>
              <Input 
                placeholder="Enter Jira Client ID" 
                value={jiraClientId}
                onChange={(e) => setJiraClientId(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Client Secret</label>
              <Input 
                type="password" 
                placeholder="Enter Jira Client Secret" 
                value={jiraClientSecret}
                onChange={(e) => setJiraClientSecret(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
