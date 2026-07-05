import React, { useState } from 'react';
import {
  BookOpen,
  Copy,
  Check,
  ChevronRight,
  ExternalLink,
  Loader2,
} from 'lucide-react';
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
  orchestratorCpuIdle?: boolean;
  orchestratorImageUriTemplate?: string;
  orchestratorMaxInstanceCount?: number;
  orchestratorMinInstanceCount?: number;
  orchestratorServiceName?: string;
  playwrightImageUriTemplate?: string;
  refreshToken?: string;
  schedulerServiceAccountEmail?: string;
  selectedProject?: string;
  updatedAt?: string;
};

type GcpProject = {
  name?: string;
  projectId: string;
};

const PROJECT_LOOKUP_DISABLED_MESSAGE =
  'Project lookup is unavailable until the Cloud Resource Manager API is enabled. Enter the project ID manually to continue setup.';
const PROJECT_LOOKUP_EMPTY_MESSAGE =
  'No projects were returned for this Google account. Enter the project ID manually to continue setup.';

const DEFAULT_ORCHESTRATOR_SERVICE_NAME = 'playrunner-orchestrator';
const DEFAULT_ORCHESTRATOR_MIN_INSTANCE_COUNT = 1;
const DEFAULT_ORCHESTRATOR_MAX_INSTANCE_COUNT = 10;
const DEFAULT_ORCHESTRATOR_CPU_IDLE = false;
const DEFAULT_SCHEDULER_SERVICE_ACCOUNT_ID = 'playrunner-scheduler';
const DEFAULT_WORKFLOW_EVENTS_TOPIC_NAME = 'playrunner-workflow-events';
const DEFAULT_API_SERVICE_NAME = 'playrunner-api';
const TERRAFORM_SETUP_COMMAND = './infra/gcp/scripts/setup-terraform.sh';
const TERRAFORM_DIRECT_COMMANDS = [
  'terraform -chdir=infra/gcp init',
  'terraform -chdir=infra/gcp plan',
  'terraform -chdir=infra/gcp apply',
].join('\n');
const DEFAULT_DOCS_URL = 'https://docs.playrunner.dev';
const GCP_SETUP_DOCS_URL = getDocsUrl('docs/cloud-architecture/gcp/setup');
const GCP_OAUTH_DOCS_URL = getDocsUrl('docs/cloud-architecture/gcp/oauth');
const GCP_TERRAFORM_DOCS_URL = getDocsUrl(
  'docs/cloud-architecture/gcp/terraform',
);
const DISCONNECT_GCP_CONFIRM_MESSAGE =
  'Disconnect GCP from Playrunner?\n\nThis removes the saved GCP credentials and settings from Playrunner. It does not delete GCP infrastructure, Artifact Registry images, Cloud Run services, or Pub/Sub topics.';

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

function buildSchedulerServiceAccountEmail(projectId: string): string {
  const trimmedProjectId = projectId.trim();
  if (!trimmedProjectId) return '';
  return `${DEFAULT_SCHEDULER_SERVICE_ACCOUNT_ID}@${trimmedProjectId}.iam.gserviceaccount.com`;
}

function isCloudResourceManagerDisabledError(data: any): boolean {
  const message =
    typeof data?.error?.message === 'string' ? data.error.message : '';
  if (message.includes('cloudresourcemanager.googleapis.com')) {
    return true;
  }

  const details = Array.isArray(data?.error?.details) ? data.error.details : [];

  return details.some((detail: any) => {
    return (
      detail?.reason === 'SERVICE_DISABLED' &&
      detail?.metadata?.service === 'cloudresourcemanager.googleapis.com'
    );
  });
}

function getProjectLookupErrorMessage(data: any): string {
  if (isCloudResourceManagerDisabledError(data)) {
    return PROJECT_LOOKUP_DISABLED_MESSAGE;
  }

  return typeof data?.error?.message === 'string'
    ? data.error.message
    : 'Failed to fetch projects from Google Cloud. Enter the project ID manually to continue setup.';
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const numberValue =
    typeof value === 'string' && value.trim()
      ? Number(value)
      : typeof value === 'number'
        ? value
        : NaN;

  return Number.isInteger(numberValue) && numberValue > 0
    ? numberValue
    : fallback;
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  const numberValue =
    typeof value === 'string' && value.trim()
      ? Number(value)
      : typeof value === 'number'
        ? value
        : NaN;

  return Number.isInteger(numberValue) && numberValue >= 0
    ? numberValue
    : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
}

function parsePositiveIntegerInput(value: string): number | null {
  const numberValue = Number(value.trim());
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function parseNonNegativeIntegerInput(value: string): number | null {
  const numberValue = Number(value.trim());
  return Number.isInteger(numberValue) && numberValue >= 0 ? numberValue : null;
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
  const [gcpClientId, setGcpClientId] = useState('');
  const [gcpClientSecret, setGcpClientSecret] = useState('');
  const [cloudRunLocation, setCloudRunLocation] = useState('');
  const [orchestratorServiceName, setOrchestratorServiceName] = useState(
    DEFAULT_ORCHESTRATOR_SERVICE_NAME,
  );
  const [orchestratorMinInstanceCount, setOrchestratorMinInstanceCount] =
    useState(String(DEFAULT_ORCHESTRATOR_MIN_INSTANCE_COUNT));
  const [orchestratorMaxInstanceCount, setOrchestratorMaxInstanceCount] =
    useState(String(DEFAULT_ORCHESTRATOR_MAX_INSTANCE_COUNT));
  const [orchestratorCpuIdle, setOrchestratorCpuIdle] = useState(
    DEFAULT_ORCHESTRATOR_CPU_IDLE,
  );
  const [projects, setProjects] = useState<GcpProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [projectFetchError, setProjectFetchError] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authSuccess, setAuthSuccess] = useState(false);
  const [isFetchingCredentials, setIsFetchingCredentials] = useState(false);
  const [isSavingRunnerSettings, setIsSavingRunnerSettings] = useState(false);
  const [runnerSettingsSaved, setRunnerSettingsSaved] = useState(false);
  const [runnerSettingsError, setRunnerSettingsError] = useState('');
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedTerraformCommand, setCopiedTerraformCommand] = useState(false);
  const popupRef = React.useRef<Window | null>(null);
  const credentialRef = React.useRef<GcpCredentialData>({
    orchestratorServiceName: DEFAULT_ORCHESTRATOR_SERVICE_NAME,
  });

  const callbackUrl = `${window.location.origin}/oauth/callback/gcp`;
  const terraformVars = React.useMemo(() => {
    const projectId = selectedProject.trim() || '<project-id>';
    const region = cloudRunLocation.trim() || 'us-central1';

    return [
      `project_id = "${projectId}"`,
      `region     = "${region}"`,
      `scheduler_service_account_id = "${DEFAULT_SCHEDULER_SERVICE_ACCOUNT_ID}"`,
      `api_service_name = "${DEFAULT_API_SERVICE_NAME}"`,
      `workflow_events_topic_name = "${DEFAULT_WORKFLOW_EVENTS_TOPIC_NAME}"`,
    ].join('\n');
  }, [cloudRunLocation, selectedProject]);

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(callbackUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleCopyTerraformCommand = () => {
    navigator.clipboard.writeText(TERRAFORM_SETUP_COMMAND);
    setCopiedTerraformCommand(true);
    setTimeout(() => setCopiedTerraformCommand(false), 2000);
  };

  const resetCredentialState = React.useCallback(() => {
    credentialRef.current = {
      orchestratorServiceName: DEFAULT_ORCHESTRATOR_SERVICE_NAME,
    };
    setGcpClientId('');
    setGcpClientSecret('');
    setCloudRunLocation('');
    setOrchestratorServiceName(DEFAULT_ORCHESTRATOR_SERVICE_NAME);
    setOrchestratorMinInstanceCount(
      String(DEFAULT_ORCHESTRATOR_MIN_INSTANCE_COUNT),
    );
    setOrchestratorMaxInstanceCount(
      String(DEFAULT_ORCHESTRATOR_MAX_INSTANCE_COUNT),
    );
    setOrchestratorCpuIdle(DEFAULT_ORCHESTRATOR_CPU_IDLE);
    setProjects([]);
    setSelectedProject('');
    setProjectFetchError('');
    setRunnerSettingsSaved(false);
    setRunnerSettingsError('');
    setCopiedTerraformCommand(false);
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
      orchestratorCpuIdle: normalizeBoolean(
        data?.orchestratorCpuIdle,
        DEFAULT_ORCHESTRATOR_CPU_IDLE,
      ),
      orchestratorMaxInstanceCount: normalizePositiveInteger(
        data?.orchestratorMaxInstanceCount,
        DEFAULT_ORCHESTRATOR_MAX_INSTANCE_COUNT,
      ),
      orchestratorMinInstanceCount: normalizeNonNegativeInteger(
        data?.orchestratorMinInstanceCount,
        DEFAULT_ORCHESTRATOR_MIN_INSTANCE_COUNT,
      ),
      playwrightImageUriTemplate:
        typeof data?.playwrightImageUriTemplate === 'string'
          ? data.playwrightImageUriTemplate
          : undefined,
      refreshToken:
        typeof data?.refreshToken === 'string' ? data.refreshToken : undefined,
      schedulerServiceAccountEmail:
        typeof data?.schedulerServiceAccountEmail === 'string'
          ? data.schedulerServiceAccountEmail
          : undefined,
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

    setGcpClientId(next.clientId || '');
    setGcpClientSecret(next.clientSecret || '');
    setCloudRunLocation(regionVal);
    setOrchestratorServiceName(svcName);
    setOrchestratorMinInstanceCount(
      String(
        next.orchestratorMinInstanceCount ??
          DEFAULT_ORCHESTRATOR_MIN_INSTANCE_COUNT,
      ),
    );
    setOrchestratorMaxInstanceCount(
      String(
        next.orchestratorMaxInstanceCount ||
          DEFAULT_ORCHESTRATOR_MAX_INSTANCE_COUNT,
      ),
    );
    setOrchestratorCpuIdle(
      typeof next.orchestratorCpuIdle === 'boolean'
        ? next.orchestratorCpuIdle
        : DEFAULT_ORCHESTRATOR_CPU_IDLE,
    );
    setSelectedProject(next.selectedProject || '');
    setRunnerSettingsSaved(false);
    setRunnerSettingsError('');
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
        orchestratorCpuIdle:
          typeof patch.orchestratorCpuIdle === 'boolean'
            ? patch.orchestratorCpuIdle
            : (credentialRef.current.orchestratorCpuIdle ??
              DEFAULT_ORCHESTRATOR_CPU_IDLE),
        orchestratorMaxInstanceCount:
          typeof patch.orchestratorMaxInstanceCount === 'number'
            ? patch.orchestratorMaxInstanceCount
            : (credentialRef.current.orchestratorMaxInstanceCount ??
              DEFAULT_ORCHESTRATOR_MAX_INSTANCE_COUNT),
        orchestratorMinInstanceCount:
          typeof patch.orchestratorMinInstanceCount === 'number'
            ? patch.orchestratorMinInstanceCount
            : (credentialRef.current.orchestratorMinInstanceCount ??
              DEFAULT_ORCHESTRATOR_MIN_INSTANCE_COUNT),
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
      setProjectFetchError('');
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

        const fetchProjectsWithToken = async (accessToken: string) => {
          const loadedProjects: GcpProject[] = [];
          let pageToken = '';

          do {
            const url = new URL(
              'https://cloudresourcemanager.googleapis.com/v1/projects',
            );
            if (pageToken) {
              url.searchParams.set('pageToken', pageToken);
            }

            const res = await fetch(url.toString(), {
              headers: { Authorization: `Bearer ${accessToken}` },
            });
            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
              return { data, ok: false, status: res.status } as const;
            }

            if (Array.isArray(data.projects)) {
              loadedProjects.push(
                ...data.projects
                  .filter(
                    (project: { projectId?: unknown }) =>
                      typeof project.projectId === 'string' &&
                      project.projectId.trim(),
                  )
                  .map((project: { name?: unknown; projectId: string }) => ({
                    name: typeof project.name === 'string' ? project.name : '',
                    projectId: project.projectId,
                  })),
              );
            }

            pageToken =
              typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
          } while (pageToken);

          const uniqueProjects = Array.from(
            new Map(
              loadedProjects.map((project) => [project.projectId, project]),
            ).values(),
          ).sort((a, b) => a.projectId.localeCompare(b.projectId));

          return { ok: true, projects: uniqueProjects } as const;
        };

        const isExpired = cred.expiresAt
          ? Date.now() > cred.expiresAt - 5 * 60 * 1000
          : false;
        if (isExpired) {
          refreshed = await performRefresh();
        }

        let projectResult = await fetchProjectsWithToken(currentToken);

        if (!projectResult.ok && projectResult.status === 401 && !refreshed) {
          const success = await performRefresh();
          if (success) {
            projectResult = await fetchProjectsWithToken(currentToken);
          }
        }

        if (projectResult.ok) {
          setProjects(projectResult.projects);
          if (!projectResult.projects.length) {
            setProjectFetchError(PROJECT_LOOKUP_EMPTY_MESSAGE);
          }
        } else {
          setProjectFetchError(
            getProjectLookupErrorMessage(projectResult.data),
          );
          console.error('Failed to fetch projects:', projectResult.data);
        }
      } catch (err) {
        setProjectFetchError(
          'Failed to fetch projects from Google Cloud. Enter the project ID manually to continue setup.',
        );
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

    const normalizedProject = selectedProject.trim();
    if (!normalizedProject) {
      setRunnerSettingsSaved(false);
      setRunnerSettingsError('Select a Google Cloud project first.');
      return;
    }

    const normalizedRegion = cloudRunLocation.trim();
    if (!normalizedRegion) {
      setRunnerSettingsSaved(false);
      setRunnerSettingsError('Cloud Run region is required.');
      return;
    }

    const normalizedServiceName =
      orchestratorServiceName.trim() || DEFAULT_ORCHESTRATOR_SERVICE_NAME;

    const minInstanceCount = parseNonNegativeIntegerInput(
      orchestratorMinInstanceCount,
    );
    if (minInstanceCount === null) {
      setRunnerSettingsSaved(false);
      setRunnerSettingsError(
        'Minimum instances must be a non-negative integer.',
      );
      return;
    }

    const maxInstanceCount = parsePositiveIntegerInput(
      orchestratorMaxInstanceCount,
    );
    if (maxInstanceCount === null) {
      setRunnerSettingsSaved(false);
      setRunnerSettingsError('Maximum instances must be a positive integer.');
      return;
    }

    if (maxInstanceCount < minInstanceCount) {
      setRunnerSettingsSaved(false);
      setRunnerSettingsError('Maximum instances must be at least the minimum.');
      return;
    }

    setIsSavingRunnerSettings(true);
    setRunnerSettingsError('');
    try {
      const next = await persistCredentialPatch({
        cloudRunLocation: normalizedRegion,
        orchestratorCpuIdle,
        orchestratorImageUriTemplate: buildOrchestratorTemplate(
          normalizedRegion,
          normalizedServiceName,
        ),
        orchestratorMaxInstanceCount: maxInstanceCount,
        orchestratorMinInstanceCount: minInstanceCount,
        orchestratorServiceName: normalizedServiceName,
        playwrightImageUriTemplate: buildPlaywrightTemplate(normalizedRegion),
        schedulerServiceAccountEmail:
          buildSchedulerServiceAccountEmail(normalizedProject),
        selectedProject: normalizedProject,
      });
      setOrchestratorServiceName(
        next.orchestratorServiceName || DEFAULT_ORCHESTRATOR_SERVICE_NAME,
      );
      setRunnerSettingsSaved(true);
    } catch (error) {
      console.error('Failed to save GCP settings', error);
      setRunnerSettingsError('Failed to save GCP settings.');
    } finally {
      setIsSavingRunnerSettings(false);
    }
  };

  const renderCommandBlock = ({
    command,
    copied,
    onCopy,
    title,
  }: {
    command: string;
    copied: boolean;
    onCopy: () => void;
    title: string;
  }) => (
    <div className="relative">
      <code className="block overflow-x-auto whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] p-3 pr-12 font-mono text-xs text-[var(--foreground)]">
        {command}
      </code>
      <button
        type="button"
        onClick={onCopy}
        className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--background)] text-muted transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
        title={title}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );

  const renderSetupGuideCallout = ({
    description,
    href = GCP_SETUP_DOCS_URL,
    linkLabel = 'Open GCP setup guide',
    title = 'First-time Google Cloud setup',
  }: {
    description: string;
    href?: string;
    linkLabel?: string;
    title?: string;
  }) => (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] p-4 text-left">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--background)]">
          <BookOpen className="h-4 w-4 text-muted" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--foreground)]">
            {title}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {description}
          </p>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--foreground)] underline underline-offset-4 hover:text-muted"
          >
            {linkLabel}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </div>
  );

  const handleDisconnectGcp = async () => {
    if (!auth.currentUser) return;
    if (!window.confirm(DISCONNECT_GCP_CONFIRM_MESSAGE)) return;

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
      className="select-text"
      bodyClassName="select-text"
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
            <span
              className={`min-h-5 flex-1 text-xs ${runnerSettingsError ? 'text-red-500' : 'text-emerald-500'}`}
            >
              {runnerSettingsError ||
                (runnerSettingsSaved ? 'GCP settings saved.' : '')}
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
                      'Save GCP Settings'
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
                      'Save GCP Settings'
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

          <div className="bg-[var(--background)] border border-[var(--border)] rounded-xl p-4 text-left max-w-2xl mx-auto w-full space-y-5">
            <div className="border-b border-subtle pb-3">
              <h4 className="text-sm font-medium text-[var(--foreground)]">
                2. Project and region
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Save the GCP project and Cloud Run region here. The Terraform
                setup script reads these saved values from Postgres.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">
                  Google Cloud Project
                </label>
                {isLoadingProjects ? (
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <Loader2 className="w-3 h-3 animate-spin" /> Loading
                    projects...
                  </div>
                ) : (
                  <>
                    <Input
                      list="gcp-project-options"
                      placeholder="project-id"
                      value={selectedProject}
                      onChange={(e) => {
                        const newProject = e.target.value;
                        setSelectedProject(newProject);
                        setRunnerSettingsSaved(false);
                        setRunnerSettingsError('');
                        setProjectFetchError('');
                      }}
                      onBlur={async () => {
                        const newProject = selectedProject.trim();
                        if (auth.currentUser) {
                          await persistCredentialPatch({
                            schedulerServiceAccountEmail:
                              buildSchedulerServiceAccountEmail(newProject),
                            selectedProject: newProject,
                          });
                        }
                      }}
                    />
                    <datalist id="gcp-project-options">
                      {projects.map((project) => (
                        <option
                          key={project.projectId}
                          value={project.projectId}
                        >
                          {project.name || project.projectId}
                        </option>
                      ))}
                    </datalist>
                    <p className="mt-1.5 text-xs text-muted leading-relaxed">
                      {projectFetchError
                        ? projectFetchError
                        : projects.length
                          ? `${projects.length} project${projects.length === 1 ? '' : 's'} loaded.`
                          : 'Enter a Google Cloud project ID. Project lookup is optional before Terraform.'}
                    </p>
                  </>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">
                  Cloud Run Region
                </label>
                <Input
                  value={cloudRunLocation}
                  onChange={(e) => {
                    setCloudRunLocation(e.target.value);
                    setRunnerSettingsSaved(false);
                    setRunnerSettingsError('');
                  }}
                  placeholder="us-central1"
                />
              </div>

              <details className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                <summary className="cursor-pointer text-xs font-medium text-[var(--foreground)]">
                  Advanced runner defaults
                </summary>
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-muted mb-1.5">
                      Orchestrator Service Name
                    </label>
                    <Input
                      value={orchestratorServiceName}
                      onChange={(e) => {
                        setOrchestratorServiceName(e.target.value);
                        setRunnerSettingsSaved(false);
                        setRunnerSettingsError('');
                      }}
                      placeholder={DEFAULT_ORCHESTRATOR_SERVICE_NAME}
                    />
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div>
                      <label className="block text-xs font-medium text-muted mb-1.5">
                        Min Instances
                      </label>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={orchestratorMinInstanceCount}
                        onChange={(e) => {
                          setOrchestratorMinInstanceCount(e.target.value);
                          setRunnerSettingsSaved(false);
                          setRunnerSettingsError('');
                        }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-muted mb-1.5">
                        Max Instances
                      </label>
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={orchestratorMaxInstanceCount}
                        onChange={(e) => {
                          setOrchestratorMaxInstanceCount(e.target.value);
                          setRunnerSettingsSaved(false);
                          setRunnerSettingsError('');
                        }}
                      />
                    </div>
                    <label className="flex min-h-[62px] items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-left">
                      <input
                        type="checkbox"
                        checked={!orchestratorCpuIdle}
                        onChange={(e) => {
                          setOrchestratorCpuIdle(!e.target.checked);
                          setRunnerSettingsSaved(false);
                          setRunnerSettingsError('');
                        }}
                        className="h-4 w-4"
                      />
                      <span>
                        <span className="block text-xs font-medium text-[var(--foreground)]">
                          Always-allocated CPU
                        </span>
                        <span className="block text-xs text-muted">
                          Keeps DAG work active after `/execute`.
                        </span>
                      </span>
                    </label>
                  </div>
                </div>
              </details>
            </div>
          </div>

          <div className="bg-[var(--background)] border border-[var(--border)] rounded-xl p-4 text-left max-w-2xl mx-auto w-full space-y-4">
            <div className="border-b border-subtle pb-3">
              <h4 className="text-sm font-medium text-[var(--foreground)]">
                3. Terraform setup
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                After saving, run this from the repo root. It writes
                <code> infra/gcp/terraform.tfvars</code> from the saved project
                and region. It does not run Terraform.
              </p>
            </div>

            {renderCommandBlock({
              command: TERRAFORM_SETUP_COMMAND,
              copied: copiedTerraformCommand,
              onCopy: handleCopyTerraformCommand,
              title: 'Copy Terraform setup command',
            })}

            <p className="text-xs leading-relaxed text-muted">
              After reviewing the generated file, run Terraform directly:
            </p>

            <pre className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] p-3 text-xs leading-relaxed text-[var(--foreground)]">
              <code>{TERRAFORM_DIRECT_COMMANDS}</code>
            </pre>

            <p className="text-xs leading-relaxed text-muted">
              Terraform creates the scheduler service account from{' '}
              <code>scheduler_service_account_id</code>; the full email is an
              output, not a value you enter by hand.
            </p>

            <details className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <summary className="cursor-pointer text-xs font-medium text-[var(--foreground)]">
                Generated terraform.tfvars preview
              </summary>
              <pre className="mt-3 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] p-3 text-xs leading-relaxed text-[var(--foreground)]">
                <code>{terraformVars}</code>
              </pre>
              <p className="mt-2 text-[10px] leading-relaxed text-muted">
                The setup script writes this file from the saved settings. It
                also keeps the standard Artifact Registry image paths generated
                automatically for Playrunner.
              </p>
            </details>

            {renderSetupGuideCallout({
              description:
                'Use this guide when you need the exact Terraform steps, optional tfvars values, or image publishing command.',
              href: GCP_TERRAFORM_DOCS_URL,
              linkLabel: 'Open Terraform setup guide',
              title: 'Terraform setup guide',
            })}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {renderSetupGuideCallout({
            description:
              'Create the Google OAuth client first, then paste the generated client ID and secret here. Terraform setup happens after authentication succeeds.',
            href: GCP_OAUTH_DOCS_URL,
            linkLabel: 'Open OAuth setup guide',
            title: '1. Google OAuth setup',
          })}

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted">
              Authorized redirect URI
            </p>
            <p className="text-xs leading-relaxed text-muted">
              Use this value when the setup guide asks for the Google OAuth
              redirect URI.
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
                htmlFor="gcp-oauth-client-id"
                className="block text-xs font-medium text-muted mb-1.5"
              >
                Client ID
              </label>
              <Input
                id="gcp-oauth-client-id"
                name="playrunner-gcp-oauth-client-id"
                value={gcpClientId}
                onChange={(e) => setGcpClientId(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Enter Google OAuth client ID"
              />
            </div>
            <div>
              <label
                htmlFor="gcp-oauth-client-secret"
                className="block text-xs font-medium text-muted mb-1.5"
              >
                Client Secret
              </label>
              <Input
                id="gcp-oauth-client-secret"
                name="playrunner-gcp-oauth-client-secret"
                type="password"
                value={gcpClientSecret}
                onChange={(e) => setGcpClientSecret(e.target.value)}
                autoComplete="new-password"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Enter Google OAuth client secret"
              />
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
