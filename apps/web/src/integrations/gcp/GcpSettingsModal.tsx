import React, { useState } from "react";
import { Copy, Check, ChevronRight, Loader2 } from "lucide-react";
import { Input } from "../../components/ui/Input";
import { auth } from "../../lib/firebase";
import { DbAPI } from "../../lib/db";
import { Modal } from "../../components/ui/Modal";
import { Select } from "../../components/ui/Select";

interface GcpSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  cloudId: string;
}

export function GcpSettingsModal({ isOpen, onClose, cloudId }: GcpSettingsModalProps) {
  const [gcpClientId, setGcpClientId] = useState("");
  const [gcpClientSecret, setGcpClientSecret] = useState("");
  const [projects, setProjects] = useState<{ projectId: string; name: string }[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authSuccess, setAuthSuccess] = useState(false);
  const [isFetchingCredentials, setIsFetchingCredentials] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const popupRef = React.useRef<Window | null>(null);

  const callbackUrl = `${window.location.origin}/oauth/callback/gcp`;

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(callbackUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const fetchGcpProjects = async (cred: { accessToken: string; refreshToken?: string; clientId?: string; clientSecret?: string; expiresAt?: number }) => {
    setIsLoadingProjects(true);
    try {
      let currentToken = cred.accessToken;
      let refreshed = false;

      const performRefresh = async () => {
        if (!cred.refreshToken || !cred.clientId || !cred.clientSecret || !auth.currentUser) return false;

        try {
          const userToken = await auth.currentUser.getIdToken();
          const refreshRes = await fetch("/api/gcp/refresh", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${userToken}`
            },
            body: JSON.stringify({
              refresh_token: cred.refreshToken,
              client_id: cred.clientId,
              client_secret: cred.clientSecret
            })
          });

          if (refreshRes.ok) {
            const refreshData = await refreshRes.json();
            if (refreshData.access_token) {
              currentToken = refreshData.access_token;

              await DbAPI.saveCloudCredential(auth.currentUser.uid, "gcp", {
                accessToken: refreshData.access_token,
                expiresAt: refreshData.expires_in ? Date.now() + refreshData.expires_in * 1000 : undefined,
                updatedAt: new Date().toISOString()
              });
              return true;
            }
          }
        } catch (e) {
          console.error("Failed to refresh token", e);
        }
        return false;
      };

      const isExpired = cred.expiresAt ? Date.now() > cred.expiresAt - 5 * 60 * 1000 : false;
      if (isExpired) {
        refreshed = await performRefresh();
      }

      let res = await fetch("https://cloudresourcemanager.googleapis.com/v1/projects", {
        headers: { Authorization: `Bearer ${currentToken}` }
      });

      if (res.status === 401 && !refreshed) {
        const success = await performRefresh();
        if (success) {
          res = await fetch("https://cloudresourcemanager.googleapis.com/v1/projects", {
            headers: { Authorization: `Bearer ${currentToken}` }
          });
        }
      }

      const data = await res.json();
      if (res.ok && data.projects) {
        setProjects(data.projects);
      } else {
        console.error("Failed to fetch projects or no projects found:", data);
      }
    } catch (err) {
      console.error("Error fetching projects", err);
    } finally {
      setIsLoadingProjects(false);
    }
  };

  React.useEffect(() => {
    let isMounted = true;

    if (isOpen && cloudId === "gcp") {
      setIsFetchingCredentials(true);

      const fetchCredentials = async () => {
        try {
          if (auth.currentUser) {
            const data = await DbAPI.getCloudCredential(auth.currentUser.uid, "gcp");
            if (data && isMounted) {
              if (data.clientId && data.accessToken) {
                setGcpClientId(data.clientId);
                setGcpClientSecret(data.clientSecret || "");
                setAuthSuccess(true);
                if (data.selectedProject) setSelectedProject(data.selectedProject);
                fetchGcpProjects({
                  accessToken: data.accessToken,
                  refreshToken: data.refreshToken,
                  clientId: data.clientId,
                  clientSecret: data.clientSecret,
                  expiresAt: data.expiresAt
                });
              } else if (data.clientId) {
                setGcpClientId(data.clientId);
                setGcpClientSecret(data.clientSecret || "");
              }
            }
          }
        } catch (error) {
          console.error("Failed to fetch cloud credentials", error);
        } finally {
          if (isMounted) setIsFetchingCredentials(false);
        }
      };

      fetchCredentials();
    } else if (!isOpen) {
      setAuthSuccess(false);
      setIsAuthenticating(false);
      setIsFetchingCredentials(false);
      setGcpClientId("");
      setGcpClientSecret("");
      setProjects([]);
      setSelectedProject("");
    }

    return () => {
      isMounted = false;
    };
  }, [isOpen, cloudId]);

  const handleAuthenticateGcp = async () => {
    try {
      setIsAuthenticating(true);

      if (auth.currentUser) {
        await DbAPI.saveCloudCredential(auth.currentUser.uid, "gcp", {
          clientId: gcpClientId,
          clientSecret: gcpClientSecret,
          updatedAt: new Date().toISOString()
        });
      }

      const messageListener = async (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type === "oauth_callback" && event.data?.success) {
          if (auth.currentUser && event.data?.params?.code) {
            try {
              const token = await auth.currentUser.getIdToken();
              const tokenRes = await fetch("/api/gcp/token", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({
                  code: event.data.params.code,
                  client_id: gcpClientId,
                  client_secret: gcpClientSecret,
                  redirect_uri: callbackUrl
                })
              });

              const tokenData = await tokenRes.json();

              if (!tokenRes.ok || !tokenData.access_token) {
                throw new Error(`Failed to retrieve access token: ${JSON.stringify(tokenData)}`);
              }

              await DbAPI.saveCloudCredential(auth.currentUser.uid, "gcp", {
                clientId: gcpClientId,
                clientSecret: gcpClientSecret,
                code: event.data.params.code,
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token,
                expiresAt: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : undefined,
                updatedAt: new Date().toISOString()
              });
              fetchGcpProjects({
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token,
                clientId: gcpClientId,
                clientSecret: gcpClientSecret,
                expiresAt: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : undefined
              });
              if (popupRef.current) popupRef.current.postMessage({ type: "oauth_close" }, window.location.origin);
            } catch (err) {
              console.error("Failed to save auth code:", err);
              if (popupRef.current) popupRef.current.postMessage({ type: "oauth_close" }, window.location.origin);
            }
          }

          setIsAuthenticating(false);
          setAuthSuccess(true);
          localStorage.setItem("primaryCloud", cloudId.toUpperCase());
          window.removeEventListener("message", messageListener);
        }
      };

      window.addEventListener("message", messageListener);

      const redirectUri = encodeURIComponent(`${window.location.origin}/oauth/callback/gcp`);
      const scope = encodeURIComponent("https://www.googleapis.com/auth/cloud-platform");
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${gcpClientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`;

      const width = 500;
      const height = 600;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      popupRef.current = window.open(
        authUrl,
        "GoogleOAuth",
        `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width=${width}, height=${height}, top=${top}, left=${left}`
      );

      const checkPopup = setInterval(() => {
        if (!popupRef.current || popupRef.current.closed) {
          clearInterval(checkPopup);
          setIsAuthenticating(false);
          window.removeEventListener("message", messageListener);
        }
      }, 500);
    } catch (error) {
      console.error("Failed to save credentials", error);
      setIsAuthenticating(false);
    }
  };

  const handleDisconnectGcp = async () => {
    if (!auth.currentUser) return;
    try {
      await DbAPI.deleteCloudCredential(auth.currentUser.uid, "gcp");
      setAuthSuccess(false);
      setGcpClientId("");
      setGcpClientSecret("");
      setProjects([]);
      setSelectedProject("");
      localStorage.removeItem("primaryCloud");
      onClose();
    } catch (error) {
      console.error("Failed to disconnect GCP", error);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      zIndex={70}
      title={`Connect to ${cloudId.toUpperCase()}`}
      icon={<img src={`/images/integrations/${cloudId.toLowerCase()}.svg`} alt={cloudId} className="w-5 h-5 object-contain" />}
      footer={
        cloudId === "gcp" && !authSuccess ? (
          <button
            onClick={handleAuthenticateGcp}
            disabled={!gcpClientId || !gcpClientSecret || isAuthenticating}
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
        ) : undefined
      }
    >
      {isFetchingCredentials ? (
        <div className="py-8 flex items-center justify-center gap-2 text-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading credentials...
        </div>
      ) : authSuccess ? (
        <div className="text-center py-4">
          <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
            <Check className="w-6 h-6 text-emerald-400" />
          </div>
          <h3 className="text-base font-semibold text-[var(--foreground)] mb-2">Connected to GCP</h3>
          <p className="text-sm text-muted mb-6">Your workspace can now run workloads in Google Cloud.</p>

          <div className="bg-[var(--control-bg)] border border-[var(--border)] rounded-lg p-4 text-left max-w-sm mx-auto mb-6 w-full">
            <h4 className="text-sm font-medium text-[var(--foreground)] mb-2">Select Google Cloud Project</h4>
            {isLoadingProjects ? (
              <div className="flex items-center gap-2 text-xs text-muted">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading projects...
              </div>
            ) : (
              <Select
                value={selectedProject}
                onChange={async (e) => {
                  const newProject = e.target.value;
                  setSelectedProject(newProject);
                  if (auth.currentUser) {
                    await DbAPI.saveCloudCredential(auth.currentUser.uid, "gcp", {
                      selectedProject: newProject
                    });
                  }
                }}
              >
                <option value="">Select a project</option>
                {projects.map((project) => (
                  <option key={project.projectId} value={project.projectId}>
                    {project.name || project.projectId}
                  </option>
                ))}
              </Select>
            )}
          </div>

          <button
            onClick={handleDisconnectGcp}
            className="text-sm text-red-400 hover:text-red-300 transition-colors"
          >
            Disconnect GCP
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <ol className="list-decimal pl-4 space-y-3 text-sm text-[var(--foreground)]">
            <li>
              Go to the <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline">Google Cloud Console APIs &amp; Services</a> page.
            </li>
            <li>
              Before creating credentials, click <strong>OAuth consent screen</strong> on the left menu.
            </li>
            <li>
              Choose the user type (for example <strong>External</strong>) and click <strong>Create</strong>. Under <strong>App information / Branding</strong>, set the app name and provide user support emails, then save.
            </li>
            <li>
              In the <strong>Test users</strong> step of the consent screen, add your email address.
              <p className="mt-2 text-xs text-blue-400 font-medium">IMPORTANT: Skipping this will cause an "Access blocked" or "Access denied" error when you authenticate.</p>
            </li>
            <li>
              Go back to <strong>Credentials</strong>, click <strong>Create Credentials</strong>, and select <strong>OAuth client ID</strong>.
            </li>
            <li>
              Set <strong>Application type</strong> to <strong>Web application</strong>.
            </li>
            <li>
              Add the following <strong>Authorized redirect URI</strong>:
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
              Copy your <strong>Client ID</strong> and <strong>Client Secret</strong> and paste them into the fields below.
            </li>
          </ol>

          <div className="space-y-4 pt-2 border-t border-subtle">
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Client ID</label>
              <Input
                value={gcpClientId}
                onChange={(e) => setGcpClientId(e.target.value)}
                placeholder="Enter Google OAuth client ID"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Client Secret</label>
              <Input
                type="password"
                value={gcpClientSecret}
                onChange={(e) => setGcpClientSecret(e.target.value)}
                placeholder="Enter Google OAuth client secret"
              />
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
