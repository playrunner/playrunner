import React, { useState } from 'react';
import {
  BookOpen,
  Copy,
  Check,
  ChevronRight,
  ExternalLink,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import {
  IntegrationConnectionAutofillGuard,
  IntegrationConnectionInput,
  useIntegrationHost,
} from '@playrunner/integration-sdk';
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

type GcpWizardStep = 'oauth' | 'project-region' | 'terraform';

type GcpActionButtonVariant = 'primary' | 'secondary' | 'danger' | 'tertiary';

const GCP_WIZARD_STEPS: Array<{
  description: string;
  id: GcpWizardStep;
  label: string;
  stepNumber: number;
}> = [
  {
    description: 'Google OAuth access',
    id: 'oauth',
    label: 'OAuth',
    stepNumber: 1,
  },
  {
    description: 'Project and region',
    id: 'project-region',
    label: 'Project & Region',
    stepNumber: 2,
  },
  {
    description: 'Terraform commands',
    id: 'terraform',
    label: 'Terraform',
    stepNumber: 3,
  },
];

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
const DEFAULT_DOCS_URL = 'https://playrunner.dev';
const GCP_SETUP_DOCS_URL = getDocsUrl('docs/cloud-architecture/gcp/setup');
const GCP_OAUTH_DOCS_URL = getDocsUrl('docs/cloud-architecture/gcp/oauth');
const GCP_PROJECT_REGION_DOCS_URL = getDocsUrl(
  'docs/cloud-architecture/gcp/project-region',
);
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
  const [authError, setAuthError] = useState('');
  const [isFetchingCredentials, setIsFetchingCredentials] = useState(false);
  const [isSavingRunnerSettings, setIsSavingRunnerSettings] = useState(false);
  const [runnerSettingsSaved, setRunnerSettingsSaved] = useState(false);
  const [runnerSettingsError, setRunnerSettingsError] = useState('');
  const [activeStep, setActiveStep] = useState<GcpWizardStep>('oauth');
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
    setAuthError('');
    setRunnerSettingsSaved(false);
    setRunnerSettingsError('');
    setActiveStep('oauth');
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
                setAuthError('');
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
      setAuthError('');
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
      setAuthError('');

      if (auth.currentUser) {
        await persistCredentialPatch({
          clientId: gcpClientId,
          clientSecret: gcpClientSecret,
        });
      }

      const messageListener = async (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type === 'oauth_callback' && event.data?.success) {
          let didConnect = false;

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
              didConnect = true;
              void fetchGcpProjects({
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
              setAuthError(
                'Failed to complete Google OAuth. Check the client ID and secret, then try again.',
              );
              if (popupRef.current)
                popupRef.current.postMessage(
                  { type: 'oauth_close' },
                  window.location.origin,
                );
            }
          } else {
            setAuthError(
              'Google OAuth did not return an authorization code. Try authenticating again.',
            );
          }

          setIsAuthenticating(false);
          if (didConnect) {
            setAuthError('');
            setAuthSuccess(true);
            setActiveStep('project-region');
            localStorage.setItem('primaryCloud', cloudId.toUpperCase());
          }
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
      setAuthError(
        'Failed to start Google OAuth. Check the client ID and secret, then try again.',
      );
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
      setActiveStep('terraform');
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
      setAuthError('');
      resetCredentialState();
      localStorage.removeItem('primaryCloud');
      onClose();
    } catch (error) {
      console.error('Failed to disconnect GCP', error);
    }
  };

  const loadProjectsFromSavedCredential = React.useCallback(() => {
    if (!authSuccess || isLoadingProjects) return;

    const credential = credentialRef.current;
    if (!credential.accessToken) {
      setProjectFetchError(
        'Project lookup needs a saved Google OAuth token. Reconnect OAuth, then try again.',
      );
      return;
    }

    void fetchGcpProjects({
      accessToken: credential.accessToken,
      refreshToken: credential.refreshToken,
      clientId: credential.clientId,
      clientSecret: credential.clientSecret,
      expiresAt: credential.expiresAt,
    });
  }, [authSuccess, fetchGcpProjects, isLoadingProjects]);

  const isProjectRegionComplete = Boolean(
    selectedProject.trim() && cloudRunLocation.trim(),
  );

  const isStepComplete = (stepId: GcpWizardStep) => {
    if (stepId === 'oauth') return authSuccess;
    if (stepId === 'project-region') return isProjectRegionComplete;
    return false;
  };

  const renderActionButton = ({
    children,
    className = '',
    variant = 'primary',
    ...buttonProps
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: GcpActionButtonVariant;
  }) => {
    if (Button) {
      return (
        <Button {...buttonProps} variant={variant} className={className}>
          {children}
        </Button>
      );
    }

    const variantClassName =
      variant === 'danger'
        ? 'border border-red-500/20 bg-red-500/10 text-red-500 hover:bg-red-500/20'
        : variant === 'secondary'
          ? 'border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--foreground)] hover:bg-[var(--surface-hover)] shadow-sm'
          : variant === 'tertiary'
            ? 'text-muted hover:text-[var(--foreground)] hover:bg-[var(--surface-hover)]'
            : 'bg-[var(--accent)] text-[var(--accent-foreground)] hover:bg-[var(--accent)]/90 shadow-sm';

    return (
      <button
        {...buttonProps}
        className={`inline-flex h-9 items-center justify-center rounded-lg px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variantClassName} ${className}`}
      >
        {children}
      </button>
    );
  };

  const renderWizardSteps = () => (
    <div className="grid gap-2 sm:grid-cols-3">
      {GCP_WIZARD_STEPS.map((step) => {
        const isActive = activeStep === step.id;
        const isComplete = isStepComplete(step.id);

        return (
          <button
            key={step.id}
            type="button"
            onClick={() => setActiveStep(step.id)}
            aria-pressed={isActive}
            className={`flex min-h-[82px] items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
              isActive
                ? 'border-[var(--border-strong)] bg-[var(--surface-hover)] text-[var(--foreground)]'
                : 'border-[var(--border)] bg-[var(--background)] text-muted hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]'
            }`}
          >
            <span
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                isComplete
                  ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-500'
                  : isActive
                    ? 'bg-[var(--accent)] text-[var(--accent-foreground)]'
                    : 'border border-[var(--border)] bg-[var(--surface)] text-muted'
              }`}
            >
              {isComplete ? <Check className="h-3.5 w-3.5" /> : step.stepNumber}
            </span>
            <span className="min-w-0">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted">
                Step {step.stepNumber}
              </span>
              <span className="block text-sm font-medium">{step.label}</span>
              <span className="mt-0.5 block text-xs leading-snug text-muted">
                {step.description}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );

  const renderConnectedStatusCard = () => (
    <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-left">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-[var(--background)]">
        <Check className="h-5 w-5 text-emerald-500" />
      </div>
      <div>
        <h3 className="text-sm font-medium text-[var(--foreground)]">
          Connected already
        </h3>
        <p className="text-xs leading-relaxed text-muted">
          Your workspace can run workloads in Google Cloud. OAuth credentials
          are already saved for this connection.
        </p>
      </div>
    </div>
  );

  const renderOauthStep = () => (
    <div className="space-y-4">
      {renderSetupGuideCallout({
        description:
          'Create the Google OAuth client first, then paste the generated client ID and secret here. Terraform setup happens after authentication succeeds.',
        href: GCP_OAUTH_DOCS_URL,
        linkLabel: 'Open OAuth setup guide',
        title: '1. Google OAuth setup',
      })}

      {authSuccess ? (
        renderConnectedStatusCard()
      ) : (
        <div className="space-y-5 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 text-left">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted">
              Authorized redirect URI
            </p>
            <p className="text-xs leading-relaxed text-muted">
              Use this value when the setup guide asks for the Google OAuth
              redirect URI.
            </p>
            <div className="relative">
              <code className="block overflow-x-auto whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] p-3 pr-10 font-mono text-xs text-[var(--foreground)] select-all">
                {callbackUrl}
              </code>
              <button
                type="button"
                onClick={handleCopyUrl}
                className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--background)] text-muted transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
                title="Copy URL"
              >
                {copiedUrl ? (
                  <Check className="h-3.5 w-3.5 text-green-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>

          <div className="space-y-4 border-t border-subtle pt-4">
            <div>
              <label
                htmlFor="gcp-connection-field-a"
                className="mb-1.5 block text-xs font-medium text-muted"
              >
                Client ID
              </label>
              <IntegrationConnectionInput
                id="gcp-connection-field-a"
                connectionId="gcp"
                fieldSlot="a"
                value={gcpClientId}
                onChange={(e) => setGcpClientId(e.target.value)}
                placeholder="Paste value from Google OAuth app"
              />
            </div>
            <div>
              <label
                htmlFor="gcp-connection-field-b"
                className="mb-1.5 block text-xs font-medium text-muted"
              >
                Client Secret
              </label>
              <IntegrationConnectionInput
                id="gcp-connection-field-b"
                connectionId="gcp"
                fieldSlot="b"
                mode="secret"
                value={gcpClientSecret}
                onChange={(e) => setGcpClientSecret(e.target.value)}
                placeholder="Paste value from Google OAuth app"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderProjectRegionStep = () => (
    <div className="space-y-4">
      {renderSetupGuideCallout({
        description:
          'Save the GCP project and Cloud Run region here. The Terraform setup script reads these saved values from Postgres.',
        href: GCP_PROJECT_REGION_DOCS_URL,
        linkLabel: 'Open Project and Region guide',
        title: '2. Project and region',
      })}

      <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 text-left">
        {!authSuccess ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs leading-relaxed text-muted">
            OAuth is not connected yet. You can still enter project and region
            settings now, then complete OAuth before running workloads.
          </div>
        ) : null}

        <div className="space-y-4">
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <label
                htmlFor="gcp-connection-field-c"
                className="block text-xs font-medium text-muted"
              >
                Google Cloud Project
              </label>
              {authSuccess ? (
                <button
                  type="button"
                  onClick={loadProjectsFromSavedCredential}
                  disabled={isLoadingProjects}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
                  title="Refresh Google Cloud project list"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${isLoadingProjects ? 'animate-spin' : ''}`}
                  />
                  Refresh projects
                </button>
              ) : null}
            </div>
            <IntegrationConnectionInput
              id="gcp-connection-field-c"
              connectionId="gcp"
              fieldSlot="c"
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
              onFocus={loadProjectsFromSavedCredential}
            />
            <datalist id="gcp-project-options">
              {projects.map((project) => (
                <option key={project.projectId} value={project.projectId}>
                  {project.name || project.projectId}
                </option>
              ))}
            </datalist>
            <p
              className="mt-1.5 flex min-h-4 items-center gap-1.5 text-xs leading-relaxed text-muted"
              aria-live="polite"
            >
              {isLoadingProjects ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading projects...
                </>
              ) : projectFetchError ? (
                projectFetchError
              ) : projects.length ? (
                `${projects.length} project${projects.length === 1 ? '' : 's'} loaded.`
              ) : (
                'Start typing to select a loaded project, or type the Project ID manually if it is not listed.'
              )}
            </p>
          </div>

          <div>
            <label
              htmlFor="gcp-connection-field-d"
              className="mb-1.5 block text-xs font-medium text-muted"
            >
              Cloud Run Region
            </label>
            <IntegrationConnectionInput
              id="gcp-connection-field-d"
              connectionId="gcp"
              fieldSlot="d"
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
                <label
                  htmlFor="gcp-connection-field-e"
                  className="mb-1.5 block text-xs font-medium text-muted"
                >
                  Orchestrator Service Name
                </label>
                <IntegrationConnectionInput
                  id="gcp-connection-field-e"
                  connectionId="gcp"
                  fieldSlot="e"
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
                  <label
                    htmlFor="gcp-connection-field-f"
                    className="mb-1.5 block text-xs font-medium text-muted"
                  >
                    Min Instances
                  </label>
                  <IntegrationConnectionInput
                    id="gcp-connection-field-f"
                    connectionId="gcp"
                    fieldSlot="f"
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
                  <label
                    htmlFor="gcp-connection-field-g"
                    className="mb-1.5 block text-xs font-medium text-muted"
                  >
                    Max Instances
                  </label>
                  <IntegrationConnectionInput
                    id="gcp-connection-field-g"
                    connectionId="gcp"
                    fieldSlot="g"
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
    </div>
  );

  const renderTerraformStep = () => (
    <div className="space-y-4">
      {renderSetupGuideCallout({
        description:
          'After saving, run this from the repo root. It writes infra/gcp/terraform.tfvars from the saved project and region. It does not run Terraform.',
        href: GCP_TERRAFORM_DOCS_URL,
        linkLabel: 'Open Terraform setup guide',
        title: '3. Terraform setup',
      })}

      <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 text-left">
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
            The setup script writes this file from the saved settings. It also
            keeps the standard Artifact Registry image paths generated
            automatically for Playrunner.
          </p>
        </details>
      </div>
    </div>
  );

  const renderActiveStep = () => {
    if (activeStep === 'project-region') return renderProjectRegionStep();
    if (activeStep === 'terraform') return renderTerraformStep();
    return renderOauthStep();
  };

  const renderWizardFooter = () => {
    if (isFetchingCredentials) return undefined;

    const footerStatusMessage =
      runnerSettingsError || (runnerSettingsSaved ? 'GCP settings saved.' : '');
    const footerStatusClassName = runnerSettingsError
      ? 'text-red-500'
      : 'text-emerald-500';

    if (activeStep === 'oauth') {
      const oauthStatusMessage = authSuccess ? 'Connected to GCP.' : authError;
      const oauthStatusClassName = authError
        ? 'text-red-500'
        : authSuccess
          ? 'text-emerald-500'
          : 'text-muted';

      return (
        <div className="flex w-full items-center gap-3">
          <span className={`min-h-5 flex-1 text-xs ${oauthStatusClassName}`}>
            {oauthStatusMessage}
          </span>
          <div className="flex shrink-0 items-center justify-end gap-2">
            {authSuccess ? (
              <>
                {renderActionButton({
                  children: 'Disconnect GCP',
                  disabled: isSavingRunnerSettings,
                  onClick: handleDisconnectGcp,
                  type: 'button',
                  variant: 'danger',
                })}
                {renderActionButton({
                  children: 'Close',
                  disabled: isSavingRunnerSettings,
                  onClick: onClose,
                  type: 'button',
                  variant: 'secondary',
                })}
                {renderActionButton({
                  children: (
                    <>
                      Project & Region
                      <ChevronRight className="h-4 w-4" />
                    </>
                  ),
                  className: 'gap-2',
                  disabled: isSavingRunnerSettings,
                  onClick: () => setActiveStep('project-region'),
                  type: 'button',
                })}
              </>
            ) : (
              <>
                {renderActionButton({
                  children: 'Close',
                  onClick: onClose,
                  type: 'button',
                  variant: 'secondary',
                })}
                {renderActionButton({
                  children: isAuthenticating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Authenticating...
                    </>
                  ) : (
                    <>
                      Authenticate
                      <ChevronRight className="h-4 w-4" />
                    </>
                  ),
                  className: 'gap-2',
                  disabled:
                    !gcpClientId || !gcpClientSecret || isAuthenticating,
                  onClick: handleAuthenticateGcp,
                  type: 'button',
                })}
              </>
            )}
          </div>
        </div>
      );
    }

    if (activeStep === 'project-region') {
      return (
        <div className="flex w-full items-center gap-3">
          <span className={`min-h-5 flex-1 text-xs ${footerStatusClassName}`}>
            {footerStatusMessage}
          </span>
          <div className="flex shrink-0 items-center justify-end gap-2">
            {renderActionButton({
              children: 'Back',
              disabled: isSavingRunnerSettings,
              onClick: () => setActiveStep('oauth'),
              type: 'button',
              variant: 'secondary',
            })}
            {renderActionButton({
              children: 'Close',
              disabled: isSavingRunnerSettings,
              onClick: onClose,
              type: 'button',
              variant: 'secondary',
            })}
            {renderActionButton({
              children: isSavingRunnerSettings ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  Save and Continue
                  <ChevronRight className="h-4 w-4" />
                </>
              ),
              className: 'gap-2',
              disabled: isSavingRunnerSettings,
              onClick: handleSaveRunnerSettings,
              type: 'button',
            })}
          </div>
        </div>
      );
    }

    return (
      <div className="flex w-full items-center gap-3">
        <span className={`min-h-5 flex-1 text-xs ${footerStatusClassName}`}>
          {footerStatusMessage}
        </span>
        <div className="flex shrink-0 items-center justify-end gap-2">
          {renderActionButton({
            children: 'Back to Project & Region',
            onClick: () => setActiveStep('project-region'),
            type: 'button',
            variant: 'secondary',
          })}
          {renderActionButton({
            children: 'Close',
            onClick: onClose,
            type: 'button',
          })}
        </div>
      </div>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      zIndex={70}
      title={`Connect to ${cloudId.toUpperCase()}`}
      maxWidth="max-w-[860px]"
      className="select-text"
      bodyClassName="select-text"
      icon={
        <img
          src={gcpIconUrl}
          alt={cloudId}
          className="w-5 h-5 object-contain"
        />
      }
      footer={cloudId === 'gcp' ? renderWizardFooter() : undefined}
    >
      {isFetchingCredentials ? (
        <div className="flex items-center justify-center gap-2 py-8 text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading credentials...
        </div>
      ) : (
        <div className="space-y-5">
          <IntegrationConnectionAutofillGuard connectionId="gcp" />
          {renderWizardSteps()}
          {renderActiveStep()}
        </div>
      )}
    </Modal>
  );
}
