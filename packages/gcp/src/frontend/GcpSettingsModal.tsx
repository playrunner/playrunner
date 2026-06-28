import React, { useState } from 'react';
import { Copy, Check, ChevronRight, Loader2 } from 'lucide-react';
import { useIntegrationHost } from '@playrunner/integration-sdk';
import { gcpIconUrl } from './icon';

interface GcpSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  cloudId: string;
}

type GcpCredentialData = {
  accessToken?: string;
  clientId?: string;
  clientSecret?: string;
  cloudRunLocation?: string;
  code?: string;
  expiresAt?: number;
  orchestratorImageUriTemplate?: string;
  orchestratorServiceName?: string;
  playwrightImageUriTemplate?: string;
  refreshToken?: string;
  selectedProject?: string;
  updatedAt?: string;
};

const DEFAULT_ORCHESTRATOR_SERVICE_NAME = 'playrunner-orchestrator';

function buildOrchestratorTemplate(
  region: string,
  serviceName: string,
): string {
  const trimmedRegion = region.trim();
  if (!trimmedRegion) return '';
  const name = serviceName.trim() || DEFAULT_ORCHESTRATOR_SERVICE_NAME;
  return `${trimmedRegion}-docker.pkg.dev/{projectId}/orchestrator/${name}:latest`;
}

function buildPlaywrightTemplate(region: string): string {
  const trimmedRegion = region.trim();
  if (!trimmedRegion) return '';
  return `${trimmedRegion}-docker.pkg.dev/{projectId}/playwright-runner/playrunner-playwright-runner-{runtime}:{version}`;
}

export function GcpSettingsModal({
  isOpen,
  onClose,
  cloudId,
}: GcpSettingsModalProps) {
  const { auth, store, ui } = useIntegrationHost();
  const Button = ui.Button;
  const Input = ui.Input;
  const Modal = ui.Modal;
  const Select = ui.Select;
  const [gcpClientId, setGcpClientId] = useState('');
  const [gcpClientSecret, setGcpClientSecret] = useState('');
  const [cloudRunLocation, setCloudRunLocation] = useState('');
  const [orchestratorServiceName, setOrchestratorServiceName] = useState(
    DEFAULT_ORCHESTRATOR_SERVICE_NAME,
  );
  const [orchestratorImageUriTemplate, setOrchestratorImageUriTemplate] =
    useState('');
  const [playwrightImageUriTemplate, setPlaywrightImageUriTemplate] =
    useState('');
  const [orchestratorTemplateEdited, setOrchestratorTemplateEdited] =
    useState(false);
  const [playwrightTemplateEdited, setPlaywrightTemplateEdited] =
    useState(false);
  const [projects, setProjects] = useState<
    { projectId: string; name: string }[]
  >([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authSuccess, setAuthSuccess] = useState(false);
  const [isFetchingCredentials, setIsFetchingCredentials] = useState(false);
  const [isSavingRunnerSettings, setIsSavingRunnerSettings] = useState(false);
  const [runnerSettingsSaved, setRunnerSettingsSaved] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const popupRef = React.useRef<Window | null>(null);
  const credentialRef = React.useRef<GcpCredentialData>({
    orchestratorServiceName: DEFAULT_ORCHESTRATOR_SERVICE_NAME,
  });

  const callbackUrl = `${window.location.origin}/oauth/callback/gcp`;

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(callbackUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const resetCredentialState = React.useCallback(() => {
    credentialRef.current = {
      orchestratorServiceName: DEFAULT_ORCHESTRATOR_SERVICE_NAME,
    };
    setGcpClientId('');
    setGcpClientSecret('');
    setCloudRunLocation('');
    setOrchestratorServiceName(DEFAULT_ORCHESTRATOR_SERVICE_NAME);
    setOrchestratorImageUriTemplate('');
    setPlaywrightImageUriTemplate('');
    setOrchestratorTemplateEdited(false);
    setPlaywrightTemplateEdited(false);
    setProjects([]);
    setSelectedProject('');
    setRunnerSettingsSaved(false);
  }, []);

  const loadCredentialState = React.useCallback((data: any) => {
    const next: GcpCredentialData = {
      accessToken:
        typeof data?.accessToken === 'string' ? data.accessToken : undefined,
      clientId: typeof data?.clientId === 'string' ? data.clientId : undefined,
      clientSecret:
        typeof data?.clientSecret === 'string' ? data.clientSecret : undefined,
      cloudRunLocation:
        typeof data?.cloudRunLocation === 'string'
          ? data.cloudRunLocation
          : undefined,
      code: typeof data?.code === 'string' ? data.code : undefined,
      expiresAt:
        typeof data?.expiresAt === 'number' ? data.expiresAt : undefined,
      orchestratorImageUriTemplate:
        typeof data?.orchestratorImageUriTemplate === 'string'
          ? data.orchestratorImageUriTemplate
          : undefined,
      orchestratorServiceName:
        typeof data?.orchestratorServiceName === 'string' &&
        data.orchestratorServiceName.trim()
          ? data.orchestratorServiceName
          : DEFAULT_ORCHESTRATOR_SERVICE_NAME,
      playwrightImageUriTemplate:
        typeof data?.playwrightImageUriTemplate === 'string'
          ? data.playwrightImageUriTemplate
          : undefined,
      refreshToken:
        typeof data?.refreshToken === 'string' ? data.refreshToken : undefined,
      selectedProject:
        typeof data?.selectedProject === 'string'
          ? data.selectedProject
          : undefined,
      updatedAt:
        typeof data?.updatedAt === 'string' ? data.updatedAt : undefined,
    };

    credentialRef.current = next;
    const regionVal = next.cloudRunLocation || '';
    const svcName =
      next.orchestratorServiceName || DEFAULT_ORCHESTRATOR_SERVICE_NAME;
    const storedOrch = next.orchestratorImageUriTemplate || '';
    const storedPlay = next.playwrightImageUriTemplate || '';

    setGcpClientId(next.clientId || '');
    setGcpClientSecret(next.clientSecret || '');
    setCloudRunLocation(regionVal);
    setOrchestratorServiceName(svcName);
    setOrchestratorImageUriTemplate(
      storedOrch || buildOrchestratorTemplate(regionVal, svcName),
    );
    setOrchestratorTemplateEdited(Boolean(storedOrch));
    setPlaywrightImageUriTemplate(
      storedPlay || buildPlaywrightTemplate(regionVal),
    );
    setPlaywrightTemplateEdited(Boolean(storedPlay));
    setSelectedProject(next.selectedProject || '');
    setRunnerSettingsSaved(false);
  }, []);

  const persistCredentialPatch = React.useCallback(
    async (patch: Partial<GcpCredentialData>) => {
      if (!auth.currentUser) {
        return credentialRef.current;
      }

      const next: GcpCredentialData = {
        ...credentialRef.current,
        ...patch,
        orchestratorServiceName:
          patch.orchestratorServiceName?.trim() ||
          credentialRef.current.orchestratorServiceName ||
          DEFAULT_ORCHESTRATOR_SERVICE_NAME,
        updatedAt: new Date().toISOString(),
      };

      credentialRef.current = next;
      if (!store.saveCloudCredential) {
        throw new Error(
          'Integration host store is missing saveCloudCredential.',
        );
      }

      await store.saveCloudCredential(auth.currentUser.uid, 'gcp', next);
      return next;
    },
    [auth.currentUser, store],
  );

  const fetchGcpProjects = React.useCallback(
    async (cred: {
      accessToken: string;
      refreshToken?: string;
      clientId?: string;
      clientSecret?: string;
      expiresAt?: number;
    }) => {
      setIsLoadingProjects(true);
      try {
        let currentToken = cred.accessToken;
        let refreshed = false;

        const performRefresh = async () => {
          if (
            !cred.refreshToken ||
            !cred.clientId ||
            !cred.clientSecret ||
            !auth.currentUser
          )
            return false;

          try {
            const userToken = await auth.currentUser.getIdToken();
            const refreshRes = await fetch('/api/gcp/refresh', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${userToken}`,
              },
              body: JSON.stringify({
                refresh_token: cred.refreshToken,
                client_id: cred.clientId,
                client_secret: cred.clientSecret,
              }),
            });

            if (refreshRes.ok) {
              const refreshData = await refreshRes.json();
              if (refreshData.access_token) {
                const next = await persistCredentialPatch({
                  accessToken: refreshData.access_token,
                  expiresAt: refreshData.expires_in
                    ? Date.now() + refreshData.expires_in * 1000
                    : undefined,
                });

                currentToken = next.accessToken || refreshData.access_token;
                return true;
              }
            }
          } catch (e) {
            console.error('Failed to refresh token', e);
          }
          return false;
        };

        const isExpired = cred.expiresAt
          ? Date.now() > cred.expiresAt - 5 * 60 * 1000
          : false;
        if (isExpired) {
          refreshed = await performRefresh();
        }

        let res = await fetch(
          'https://cloudresourcemanager.googleapis.com/v1/projects',
          {
            headers: { Authorization: `Bearer ${currentToken}` },
          },
        );

        if (res.status === 401 && !refreshed) {
          const success = await performRefresh();
          if (success) {
            res = await fetch(
              'https://cloudresourcemanager.googleapis.com/v1/projects',
              {
                headers: { Authorization: `Bearer ${currentToken}` },
              },
            );
          }
        }

        const data = await res.json();
        if (res.ok && data.projects) {
          setProjects(data.projects);
        } else {
          console.error('Failed to fetch projects or no projects found:', data);
        }
      } catch (err) {
        console.error('Error fetching projects', err);
      } finally {
        setIsLoadingProjects(false);
      }
    },
    [auth.currentUser, persistCredentialPatch],
  );

  React.useEffect(() => {
    let isMounted = true;

    if (isOpen && cloudId === 'gcp') {
      setIsFetchingCredentials(true);

      const fetchCredentials = async () => {
        try {
          if (auth.currentUser && store.getCloudCredential) {
            const data = await store.getCloudCredential(
              auth.currentUser.uid,
              'gcp',
            );
            if (data && isMounted) {
              loadCredentialState(data);
              if (data.clientId && data.accessToken) {
                setAuthSuccess(true);
                fetchGcpProjects({
                  accessToken: data.accessToken,
                  refreshToken: data.refreshToken,
                  clientId: data.clientId,
                  clientSecret: data.clientSecret,
                  expiresAt: data.expiresAt,
                });
              }
            }
          }
        } catch (error) {
          console.error('Failed to fetch cloud credentials', error);
        } finally {
          if (isMounted) setIsFetchingCredentials(false);
        }
      };

      fetchCredentials();
    } else if (!isOpen) {
      setAuthSuccess(false);
      setIsAuthenticating(false);
      setIsFetchingCredentials(false);
      resetCredentialState();
    }

    return () => {
      isMounted = false;
    };
  }, [
    auth.currentUser,
    cloudId,
    fetchGcpProjects,
    isOpen,
    loadCredentialState,
    resetCredentialState,
    store,
  ]);

  const handleAuthenticateGcp = async () => {
    try {
      setIsAuthenticating(true);

      if (auth.currentUser) {
        await persistCredentialPatch({
          clientId: gcpClientId,
          clientSecret: gcpClientSecret,
        });
      }

      const messageListener = async (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type === 'oauth_callback' && event.data?.success) {
          if (auth.currentUser && event.data?.params?.code) {
            try {
              const token = await auth.currentUser.getIdToken();
              const tokenRes = await fetch('/api/gcp/token', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                  code: event.data.params.code,
                  client_id: gcpClientId,
                  client_secret: gcpClientSecret,
                  redirect_uri: callbackUrl,
                }),
              });

              const tokenData = await tokenRes.json();

              if (!tokenRes.ok || !tokenData.access_token) {
                throw new Error(
                  `Failed to retrieve access token: ${JSON.stringify(tokenData)}`,
                );
              }

              const next = await persistCredentialPatch({
                clientId: gcpClientId,
                clientSecret: gcpClientSecret,
                code: event.data.params.code,
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token,
                expiresAt: tokenData.expires_in
                  ? Date.now() + tokenData.expires_in * 1000
                  : undefined,
              });
              fetchGcpProjects({
                accessToken: next.accessToken || tokenData.access_token,
                refreshToken: next.refreshToken,
                clientId: next.clientId,
                clientSecret: next.clientSecret,
                expiresAt: next.expiresAt,
              });
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
          }

          setIsAuthenticating(false);
          setAuthSuccess(true);
          localStorage.setItem('primaryCloud', cloudId.toUpperCase());
          window.removeEventListener('message', messageListener);
        }
      };

      window.addEventListener('message', messageListener);

      const redirectUri = encodeURIComponent(
        `${window.location.origin}/oauth/callback/gcp`,
      );
      const scope = encodeURIComponent(
        'https://www.googleapis.com/auth/cloud-platform',
      );
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${gcpClientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`;

      const width = 500;
      const height = 600;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      popupRef.current = window.open(
        authUrl,
        'GoogleOAuth',
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

  const handleSaveRunnerSettings = async () => {
    if (!auth.currentUser) return;

    setIsSavingRunnerSettings(true);
    try {
      const next = await persistCredentialPatch({
        cloudRunLocation: cloudRunLocation.trim(),
        orchestratorImageUriTemplate: orchestratorImageUriTemplate.trim(),
        orchestratorServiceName:
          orchestratorServiceName.trim() || DEFAULT_ORCHESTRATOR_SERVICE_NAME,
        playwrightImageUriTemplate: playwrightImageUriTemplate.trim(),
        selectedProject,
      });
      setOrchestratorServiceName(
        next.orchestratorServiceName || DEFAULT_ORCHESTRATOR_SERVICE_NAME,
      );
      setRunnerSettingsSaved(true);
      onClose();
    } catch (error) {
      console.error('Failed to save GCP runner settings', error);
    } finally {
      setIsSavingRunnerSettings(false);
    }
  };

  const handleDisconnectGcp = async () => {
    if (!auth.currentUser) return;
    try {
      if (!store.deleteCloudCredential) {
        throw new Error(
          'Integration host store is missing deleteCloudCredential.',
        );
      }

      await store.deleteCloudCredential(auth.currentUser.uid, 'gcp');
      setAuthSuccess(false);
      resetCredentialState();
      localStorage.removeItem('primaryCloud');
      onClose();
    } catch (error) {
      console.error('Failed to disconnect GCP', error);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      zIndex={70}
      title={`Connect to ${cloudId.toUpperCase()}`}
      icon={
        <img
          src={gcpIconUrl}
          alt={cloudId}
          className="w-5 h-5 object-contain"
        />
      }
      footer={
        cloudId === 'gcp' && !authSuccess ? (
          Button ? (
            <Button
              type="button"
              onClick={handleAuthenticateGcp}
              disabled={!gcpClientId || !gcpClientSecret || isAuthenticating}
              className="gap-2"
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
            </Button>
          ) : (
            <button
              type="button"
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
          )
        ) : authSuccess ? (
          <div className="flex w-full items-center gap-3">
            <span className="min-h-5 flex-1 text-xs text-emerald-500">
              {runnerSettingsSaved ? 'Runner settings saved.' : ''}
            </span>
            <div className="flex shrink-0 items-center justify-end gap-2">
              {Button ? (
                <>
                  <Button
                    type="button"
                    variant="danger"
                    onClick={handleDisconnectGcp}
                    disabled={isSavingRunnerSettings}
                  >
                    Disconnect GCP
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={onClose}
                    disabled={isSavingRunnerSettings}
                  >
                    Close
                  </Button>
                  <Button
                    type="button"
                    onClick={handleSaveRunnerSettings}
                    disabled={isSavingRunnerSettings}
                    className="gap-2"
                  >
                    {isSavingRunnerSettings ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      'Save Runner Settings'
                    )}
                  </Button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleDisconnectGcp}
                    disabled={isSavingRunnerSettings}
                    className="px-4 py-2 rounded-lg border border-red-500/20 bg-red-500/10 text-red-500 hover:bg-red-500/20 font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Disconnect GCP
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={isSavingRunnerSettings}
                    className="px-4 py-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--foreground)] hover:bg-[var(--surface-hover)] font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveRunnerSettings}
                    disabled={isSavingRunnerSettings}
                    className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-[var(--accent-foreground)] font-medium text-sm transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSavingRunnerSettings ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      'Save Runner Settings'
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        ) : undefined
      }
    >
      {isFetchingCredentials ? (
        <div className="py-8 flex items-center justify-center gap-2 text-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading credentials...
        </div>
      ) : authSuccess ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-left">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-[var(--background)]">
              <Check className="w-4 h-4 text-emerald-500" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-[var(--foreground)]">
                Connected to GCP
              </h3>
              <p className="text-xs text-muted leading-relaxed">
                Your workspace can run workloads in Google Cloud.
              </p>
            </div>
          </div>

          <div className="bg-[var(--background)] border border-[var(--border)] rounded-xl p-4 text-left max-w-2xl mx-auto w-full space-y-4">
            <div>
              <h4 className="text-sm font-medium text-[var(--foreground)] mb-2">
                Select Google Cloud Project
              </h4>
              {isLoadingProjects ? (
                <div className="flex items-center gap-2 text-xs text-muted">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading
                  projects...
                </div>
              ) : (
                <Select
                  value={selectedProject}
                  onChange={async (e) => {
                    const newProject = e.target.value;
                    setSelectedProject(newProject);
                    if (auth.currentUser) {
                      await persistCredentialPatch({
                        selectedProject: newProject,
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

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">
                  Cloud Run Region
                </label>
                <Input
                  value={cloudRunLocation}
                  onChange={(e) => {
                    const nextRegion = e.target.value;
                    setCloudRunLocation(nextRegion);
                    if (!orchestratorTemplateEdited) {
                      setOrchestratorImageUriTemplate(
                        buildOrchestratorTemplate(
                          nextRegion,
                          orchestratorServiceName,
                        ),
                      );
                    }
                    if (!playwrightTemplateEdited) {
                      setPlaywrightImageUriTemplate(
                        buildPlaywrightTemplate(nextRegion),
                      );
                    }
                    setRunnerSettingsSaved(false);
                  }}
                  placeholder="us-central1"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">
                  Orchestrator Service Name
                </label>
                <Input
                  value={orchestratorServiceName}
                  onChange={(e) => {
                    const nextName = e.target.value;
                    setOrchestratorServiceName(nextName);
                    if (!orchestratorTemplateEdited) {
                      setOrchestratorImageUriTemplate(
                        buildOrchestratorTemplate(cloudRunLocation, nextName),
                      );
                    }
                    setRunnerSettingsSaved(false);
                  }}
                  placeholder={DEFAULT_ORCHESTRATOR_SERVICE_NAME}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">
                  Orchestrator Image URI Template
                </label>
                <Input
                  value={orchestratorImageUriTemplate}
                  onChange={(e) => {
                    setOrchestratorImageUriTemplate(e.target.value);
                    setOrchestratorTemplateEdited(true);
                    setRunnerSettingsSaved(false);
                  }}
                  placeholder={`${cloudRunLocation || 'region'}-docker.pkg.dev/{projectId}/orchestrator/${orchestratorServiceName || DEFAULT_ORCHESTRATOR_SERVICE_NAME}:latest`}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">
                  Playwright Image URI Template
                </label>
                <Input
                  value={playwrightImageUriTemplate}
                  onChange={(e) => {
                    setPlaywrightImageUriTemplate(e.target.value);
                    setPlaywrightTemplateEdited(true);
                    setRunnerSettingsSaved(false);
                  }}
                  placeholder={`${cloudRunLocation || 'region'}-docker.pkg.dev/{projectId}/playwright-runner/playrunner-playwright-runner-{runtime}:{version}`}
                />
              </div>
              <p className="text-xs text-muted">
                Use <code>{'{projectId}'}</code> in both image templates, plus{' '}
                <code>{'{runtime}'}</code> and <code>{'{version}'}</code> for
                the Playwright image.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <ol className="list-decimal pl-4 space-y-3 text-sm text-[var(--foreground)]">
            <li>
              Go to the{' '}
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 hover:underline"
              >
                Google Cloud Console APIs &amp; Services
              </a>{' '}
              page.
            </li>
            <li>
              Before creating credentials, click{' '}
              <strong>OAuth consent screen</strong> on the left menu.
            </li>
            <li>
              Choose the user type (for example <strong>External</strong>) and
              click <strong>Create</strong>. Under{' '}
              <strong>App information / Branding</strong>, set the app name and
              provide user support emails, then save.
            </li>
            <li>
              In the <strong>Test users</strong> step of the consent screen, add
              your email address.
              <p className="mt-2 text-xs text-blue-400 font-medium">
                IMPORTANT: Skipping this will cause an "Access blocked" or
                "Access denied" error when you authenticate.
              </p>
            </li>
            <li>
              Go back to <strong>Credentials</strong>, click{' '}
              <strong>Create Credentials</strong>, and select{' '}
              <strong>OAuth client ID</strong>.
            </li>
            <li>
              Set <strong>Application type</strong> to{' '}
              <strong>Web application</strong>.
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
                  {copiedUrl ? (
                    <Check className="w-3.5 h-3.5 text-green-500" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </li>
            <li>
              Copy your <strong>Client ID</strong> and{' '}
              <strong>Client Secret</strong> and paste them into the fields
              below.
            </li>
          </ol>

          <div className="space-y-4 pt-2 border-t border-subtle">
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">
                Client ID
              </label>
              <Input
                value={gcpClientId}
                onChange={(e) => setGcpClientId(e.target.value)}
                placeholder="Enter Google OAuth client ID"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">
                Client Secret
              </label>
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
