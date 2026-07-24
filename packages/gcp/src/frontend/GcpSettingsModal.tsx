import React, { useState } from 'react';
import {
  BookOpen,
  Copy,
  Check,
  ChevronDown,
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
  cloudRunLocation?: string;
  orchestratorCpuIdle?: boolean;
  orchestratorImageUriTemplate?: string;
  orchestratorMaxInstanceCount?: number;
  orchestratorMinInstanceCount?: number;
  orchestratorServiceName?: string;
  playwrightImageUriTemplate?: string;
  provisioning?: GcpProvisioningResult | null;
  schedulerServiceAccountEmail?: string;
  selectedProject?: string;
};

type GcpProvisioningStep = {
  detail: string;
  id:
    | 'permissions'
    | 'services'
    | 'repositories'
    | 'pubsub'
    | 'scheduler'
    | 'images';
  label: string;
  items?: GcpProvisioningStepItem[];
  state: 'complete' | 'failed' | 'warning';
};

type GcpProvisioningStepItem = {
  detail?: string;
  label: string;
  state: 'complete' | 'failed' | 'warning';
  value?: string;
};

type GcpProvisioningResult = {
  imageCommand: string;
  missingRuntimePermissions: string[];
  projectId: string;
  ready: boolean;
  region: string;
  steps: GcpProvisioningStep[];
  updatedAt: string;
};

type GcpProject = {
  name?: string;
  projectId: string;
};

type GcpWizardStep = 'oauth' | 'project-region' | 'provision';

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
    description: 'Cloud resources',
    id: 'provision',
    label: 'Provision',
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
const PUSH_RUNNER_IMAGES_COMMAND =
  './infra/gcp/scripts/push-runners.sh --target both --yes';
const DEFAULT_DOCS_URL = 'https://playrunner.dev';
const GCP_SETUP_DOCS_URL = getDocsUrl('docs/runner-architecture/gcp/setup');
const GCP_OAUTH_DOCS_URL = getDocsUrl('docs/runner-architecture/gcp/oauth');
const GCP_PROJECT_REGION_DOCS_URL = getDocsUrl(
  'docs/runner-architecture/gcp/project-region',
);
const DISCONNECT_GCP_CONFIRM_MESSAGE =
  'Disconnect GCP from Playrunner?\n\nThis removes the saved GCP credentials and settings from Playrunner. It does not delete GCP infrastructure, Artifact Registry images, Cloud Run services, or Pub/Sub topics.';

const GCP_PERMISSION_DESCRIPTIONS: Record<string, string> = {
  'artifactregistry.dockerimages.list':
    'Check whether the runner repositories contain images.',
  'artifactregistry.repositories.create':
    'Create the Orchestrator and Playwright runner repositories.',
  'artifactregistry.repositories.get': 'Inspect existing runner repositories.',
  'cloudscheduler.jobs.create': 'Create workflow schedules.',
  'cloudscheduler.jobs.delete': 'Delete workflow schedules.',
  'cloudscheduler.jobs.get': 'Inspect workflow schedules.',
  'cloudscheduler.jobs.update': 'Update workflow schedules.',
  'iam.serviceAccounts.actAs':
    'Use the scheduler service account when creating scheduled jobs.',
  'iam.serviceAccounts.create': 'Create the scheduler service account.',
  'iam.serviceAccounts.get': 'Inspect the scheduler service account.',
  'pubsub.subscriptions.consume': 'Receive workflow runner events.',
  'pubsub.subscriptions.create':
    'Create execution, control, and status subscriptions.',
  'pubsub.subscriptions.delete':
    'Clean up execution, control, and status subscriptions.',
  'pubsub.subscriptions.get':
    'Inspect execution, control, and status subscriptions.',
  'pubsub.topics.create': 'Create the shared workflow events topic.',
  'pubsub.topics.get': 'Inspect the shared workflow events topic.',
  'pubsub.topics.publish': 'Publish runner status and workflow events.',
  'run.jobs.create': 'Create Playwright Cloud Run jobs.',
  'run.jobs.get': 'Inspect Playwright Cloud Run jobs.',
  'run.jobs.run': 'Start Playwright Cloud Run jobs.',
  'run.jobs.runWithOverrides':
    'Start Playwright jobs with workflow-specific environment overrides.',
  'run.jobs.update': 'Update Playwright Cloud Run jobs.',
  'run.services.create': 'Create the Orchestrator Cloud Run service.',
  'run.services.get': 'Inspect the Orchestrator Cloud Run service.',
  'run.services.setIamPolicy':
    'Configure access to the Orchestrator Cloud Run service.',
  'run.services.update': 'Update the Orchestrator Cloud Run service.',
  'serviceusage.services.enable': 'Enable required Google Cloud APIs.',
  'storage.buckets.create': 'Create workflow output buckets.',
  'storage.buckets.get':
    'Check whether a workflow output bucket exists and read its metadata.',
};

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

function defaultExpandedProvisioningSteps(
  provisioning: GcpProvisioningResult | null | undefined,
) {
  return new Set(
    provisioning?.steps
      .filter((step) => step.state !== 'complete')
      .map((step) => step.id) || [],
  );
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
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [provisioning, setProvisioning] =
    useState<GcpProvisioningResult | null>(null);
  const [expandedProvisioningSteps, setExpandedProvisioningSteps] = useState<
    Set<GcpProvisioningStep['id']>
  >(new Set());
  const [provisioningError, setProvisioningError] = useState('');
  const [activeStep, setActiveStep] = useState<GcpWizardStep>('oauth');
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedImageCommand, setCopiedImageCommand] = useState(false);
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

  const handleCopyImageCommand = () => {
    navigator.clipboard.writeText(
      provisioning?.imageCommand || PUSH_RUNNER_IMAGES_COMMAND,
    );
    setCopiedImageCommand(true);
    setTimeout(() => setCopiedImageCommand(false), 2000);
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
    setProvisioning(null);
    setExpandedProvisioningSteps(new Set());
    setProvisioningError('');
    setIsProvisioning(false);
    setActiveStep('oauth');
    setCopiedImageCommand(false);
  }, []);

  const loadCredentialState = React.useCallback((data: any) => {
    data = data?.config ?? {};
    const next: GcpCredentialData = {
      cloudRunLocation:
        typeof data?.cloudRunLocation === 'string'
          ? data.cloudRunLocation
          : undefined,
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
      provisioning:
        data?.provisioning &&
        typeof data.provisioning === 'object' &&
        Array.isArray(data.provisioning.steps)
          ? (data.provisioning as GcpProvisioningResult)
          : null,
      schedulerServiceAccountEmail:
        typeof data?.schedulerServiceAccountEmail === 'string'
          ? data.schedulerServiceAccountEmail
          : undefined,
      selectedProject:
        typeof data?.selectedProject === 'string'
          ? data.selectedProject
          : undefined,
    };

    credentialRef.current = next;
    const regionVal = next.cloudRunLocation || '';
    const svcName =
      next.orchestratorServiceName || DEFAULT_ORCHESTRATOR_SERVICE_NAME;

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
    setProvisioning(next.provisioning || null);
    setExpandedProvisioningSteps(
      defaultExpandedProvisioningSteps(next.provisioning),
    );
    setProvisioningError('');
    setRunnerSettingsSaved(
      Boolean(next.selectedProject?.trim() && next.cloudRunLocation?.trim()),
    );
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
      };

      credentialRef.current = next;
      if (!store.saveCloudCredential) {
        throw new Error(
          'Integration host store is missing saveCloudCredential.',
        );
      }

      await store.saveCloudCredential(auth.currentUser.uid, 'gcp', {
        provider: 'gcp',
        config: next,
      });
      return next;
    },
    [auth.currentUser, store],
  );

  const fetchGcpProjects = React.useCallback(async () => {
    setIsLoadingProjects(true);
    setProjectFetchError('');
    try {
      if (!auth.currentUser) return;
      const userToken = await auth.currentUser.getIdToken();
      const response = await fetch('/api/gcp/projects', {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        const loadedProjects = Array.isArray(data.projects)
          ? data.projects
          : [];
        setProjects(loadedProjects);
        if (!loadedProjects.length) {
          setProjectFetchError(PROJECT_LOOKUP_EMPTY_MESSAGE);
        }
      } else {
        setProjectFetchError(getProjectLookupErrorMessage(data));
        console.error('Failed to fetch projects:', data);
      }
    } catch (err) {
      setProjectFetchError(
        'Failed to fetch projects from Google Cloud. Enter the project ID manually to continue setup.',
      );
      console.error('Error fetching projects', err);
    } finally {
      setIsLoadingProjects(false);
    }
  }, [auth.currentUser]);

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
              if (data.credentialStatus?.configured) {
                setAuthError('');
                setAuthSuccess(true);
                fetchGcpProjects();
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

              if (!tokenRes.ok || !tokenData.connected) {
                throw new Error(
                  `Failed to retrieve access token: ${JSON.stringify(tokenData)}`,
                );
              }

              didConnect = true;
              void fetchGcpProjects();
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
        provisioning: null,
        schedulerServiceAccountEmail:
          buildSchedulerServiceAccountEmail(normalizedProject),
        selectedProject: normalizedProject,
      });
      setOrchestratorServiceName(
        next.orchestratorServiceName || DEFAULT_ORCHESTRATOR_SERVICE_NAME,
      );
      setRunnerSettingsSaved(true);
      setProvisioning(null);
      setExpandedProvisioningSteps(new Set());
      setProvisioningError('');
      setActiveStep('provision');
    } catch (error) {
      console.error('Failed to save GCP settings', error);
      setRunnerSettingsError('Failed to save GCP settings.');
    } finally {
      setIsSavingRunnerSettings(false);
    }
  };

  const handleProvisionGcp = async () => {
    if (!auth.currentUser) return;
    if (!authSuccess) {
      setProvisioningError('Connect Google OAuth before provisioning.');
      return;
    }
    if (!selectedProject.trim() || !cloudRunLocation.trim()) {
      setProvisioningError(
        'Save a Google Cloud project and region before provisioning.',
      );
      return;
    }

    setIsProvisioning(true);
    setProvisioningError('');
    try {
      const userToken = await auth.currentUser.getIdToken();
      const response = await fetch('/api/gcp/provision', {
        headers: { Authorization: `Bearer ${userToken}` },
        method: 'POST',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (Array.isArray(data.steps)) {
          const partialProvisioning: GcpProvisioningResult = {
            imageCommand: PUSH_RUNNER_IMAGES_COMMAND,
            missingRuntimePermissions: Array.isArray(data.missingPermissions)
              ? data.missingPermissions
              : [],
            projectId: selectedProject.trim(),
            ready: false,
            region: cloudRunLocation.trim(),
            steps: data.steps,
            updatedAt: new Date().toISOString(),
          };
          setProvisioning(partialProvisioning);
          setExpandedProvisioningSteps(
            defaultExpandedProvisioningSteps(partialProvisioning),
          );
        }
        throw new Error(
          typeof data.error === 'string'
            ? data.error
            : 'Failed to provision GCP cloud runners.',
        );
      }

      const nextProvisioning = data.provisioning as GcpProvisioningResult;
      credentialRef.current = {
        ...credentialRef.current,
        provisioning: nextProvisioning,
      };
      setProvisioning(nextProvisioning);
      setExpandedProvisioningSteps(
        defaultExpandedProvisioningSteps(nextProvisioning),
      );
    } catch (error) {
      console.error('Failed to provision GCP runners', error);
      setProvisioningError(
        error instanceof Error
          ? error.message
          : 'Failed to provision GCP cloud runners.',
      );
    } finally {
      setIsProvisioning(false);
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
        aria-label={title}
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
    void fetchGcpProjects();
  }, [authSuccess, fetchGcpProjects, isLoadingProjects]);

  const isProjectRegionComplete = Boolean(
    selectedProject.trim() && cloudRunLocation.trim(),
  );

  const isStepComplete = (stepId: GcpWizardStep) => {
    if (stepId === 'oauth') return authSuccess;
    if (stepId === 'project-region') return isProjectRegionComplete;
    return Boolean(
      provisioning?.ready &&
      provisioning.projectId === selectedProject.trim() &&
      provisioning.region === cloudRunLocation.trim(),
    );
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
          'Create the Google OAuth client first, then paste the generated client ID and secret here. Playrunner uses this connection to provision runner resources after authentication succeeds.',
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
          'Save the GCP project and Cloud Run region here. Playrunner will provision resources in this location using your OAuth connection.',
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

  const renderProvisioningStep = () => {
    const provisioningMatchesSettings =
      provisioning?.projectId === selectedProject.trim() &&
      provisioning?.region === cloudRunLocation.trim();
    const displayedProvisioning = provisioningMatchesSettings
      ? provisioning
      : null;
    const toggleProvisioningStep = (stepId: GcpProvisioningStep['id']) => {
      setExpandedProvisioningSteps((current) => {
        const next = new Set(current);
        if (next.has(stepId)) next.delete(stepId);
        else next.add(stepId);
        return next;
      });
    };

    return (
      <div className="space-y-4">
        {renderSetupGuideCallout({
          description:
            'Playrunner validates access on the actual resources, enables required APIs, and reconciles Artifact Registry, Pub/Sub, and the scheduler identity through Google Cloud APIs.',
          linkLabel: 'Open GCP setup guide',
          title: '3. Provision cloud runners',
        })}

        <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 text-left">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
            <p className="text-xs font-medium text-[var(--foreground)]">
              Terraform is not required for cloud runners
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              This OAuth setup creates and checks the runner resources directly.
              Terraform is only optional when you want to deploy and manage the
              Playrunner API/control plane in Google Cloud as well.
            </p>
          </div>

          <div className="flex items-start gap-3">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                displayedProvisioning?.ready
                  ? 'border-emerald-500/20 bg-emerald-500/10'
                  : provisioningError
                    ? 'border-red-500/20 bg-red-500/10'
                    : 'border-[var(--border)] bg-[var(--surface)]'
              }`}
            >
              {isProvisioning ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted" />
              ) : displayedProvisioning?.ready ? (
                <Check className="h-4 w-4 text-emerald-500" />
              ) : (
                <RefreshCw className="h-4 w-4 text-muted" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--foreground)]">
                {isProvisioning
                  ? 'Provisioning Google Cloud resources...'
                  : displayedProvisioning?.ready
                    ? 'Cloud runners are ready'
                    : displayedProvisioning
                      ? 'Cloud setup needs attention'
                      : 'Ready to provision'}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Project <code>{selectedProject.trim() || 'not selected'}</code>{' '}
                in{' '}
                <code>{cloudRunLocation.trim() || 'no region selected'}</code>.
                Existing resources are reused and reconciled.
              </p>
            </div>
          </div>

          {displayedProvisioning?.steps.length ? (
            <div className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--surface)]">
              {displayedProvisioning.steps.map((step) => {
                const isExpanded = expandedProvisioningSteps.has(step.id);
                const items: GcpProvisioningStepItem[] | undefined =
                  step.items?.length || step.id !== 'permissions'
                    ? step.items
                    : displayedProvisioning.missingRuntimePermissions.map(
                        (permission) => ({
                          detail:
                            GCP_PERMISSION_DESCRIPTIONS[permission] ||
                            'Required for Google Cloud runner operations.',
                          label: permission,
                          state: 'warning' as const,
                        }),
                      );

                return (
                  <div key={step.id}>
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      onClick={() => toggleProvisioningStep(step.id)}
                      className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-hover)]"
                    >
                      <span
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                          step.state === 'complete'
                            ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-500'
                            : step.state === 'failed'
                              ? 'border-red-500/20 bg-red-500/10 text-red-500'
                              : 'border-amber-500/20 bg-amber-500/10 text-amber-500'
                        }`}
                      >
                        {step.state === 'complete' ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium text-[var(--foreground)]">
                          {step.label}
                        </span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                          {step.detail}
                        </span>
                      </span>
                      <ChevronDown
                        className={`mt-1 h-4 w-4 shrink-0 text-muted transition-transform ${
                          isExpanded ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    {isExpanded ? (
                      <div className="space-y-2 border-t border-[var(--border)] bg-[var(--background)] px-3 py-3">
                        {items?.length ? (
                          items.map((item, index) => (
                            <div
                              key={`${item.label}-${item.value || index}`}
                              className="flex items-start gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
                            >
                              <span
                                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                                  item.state === 'complete'
                                    ? 'bg-emerald-500'
                                    : item.state === 'failed'
                                      ? 'bg-red-500'
                                      : 'bg-amber-500'
                                }`}
                              />
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium text-[var(--foreground)]">
                                  {item.label}
                                </p>
                                {item.value ? (
                                  <code className="mt-1 block overflow-x-auto font-mono text-xs text-[var(--foreground)]">
                                    {item.value}
                                  </code>
                                ) : null}
                                {item.detail ? (
                                  <p className="mt-1 text-xs leading-relaxed text-muted">
                                    {GCP_PERMISSION_DESCRIPTIONS[item.label] ||
                                      item.detail}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="text-xs leading-relaxed text-muted">
                            Detailed results were not saved by the previous
                            setup check. Click Recheck setup to refresh them.
                          </p>
                        )}
                      </div>
                    ) : null}

                    {step.id === 'images' && step.state === 'warning' ? (
                      <div className="border-t border-[var(--border)] px-3 py-3">
                        {renderCommandBlock({
                          command:
                            displayedProvisioning.imageCommand ||
                            PUSH_RUNNER_IMAGES_COMMAND,
                          copied: copiedImageCommand,
                          onCopy: handleCopyImageCommand,
                          title: 'Copy runner image command',
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs leading-relaxed text-muted">
              Provisioning validates access while reading or reconciling each
              actual resource. It is safe to run again if setup is interrupted.
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderActiveStep = () => {
    if (activeStep === 'project-region') return renderProjectRegionStep();
    if (activeStep === 'provision') return renderProvisioningStep();
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
        <span
          className={`min-h-5 flex-1 text-xs ${
            provisioningError
              ? 'text-red-500'
              : provisioning?.ready
                ? 'text-emerald-500'
                : 'text-muted'
          }`}
        >
          {provisioningError ||
            (provisioning?.ready
              ? 'Cloud runners are ready.'
              : provisioning
                ? 'Cloud resources provisioned; review remaining items.'
                : '')}
        </span>
        <div className="flex shrink-0 items-center justify-end gap-2">
          {renderActionButton({
            children: 'Back to Project & Region',
            disabled: isProvisioning,
            onClick: () => setActiveStep('project-region'),
            type: 'button',
            variant: 'secondary',
          })}
          {renderActionButton({
            children: isProvisioning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Provisioning...
              </>
            ) : provisioning?.ready ? (
              <>
                <RefreshCw className="h-4 w-4" />
                Recheck setup
              </>
            ) : (
              <>
                Provision cloud runners
                <ChevronRight className="h-4 w-4" />
              </>
            ),
            className: 'gap-2',
            disabled:
              isProvisioning ||
              !authSuccess ||
              !isProjectRegionComplete ||
              !runnerSettingsSaved,
            onClick: handleProvisionGcp,
            type: 'button',
          })}
          {provisioning?.ready
            ? renderActionButton({
                children: 'Close',
                disabled: isProvisioning,
                onClick: onClose,
                type: 'button',
                variant: 'secondary',
              })
            : null}
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
