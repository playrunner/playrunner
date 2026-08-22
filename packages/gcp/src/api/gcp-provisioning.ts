import {
  findPlayrunnerRepoRoot,
  getRunnerBuildFingerprints,
} from './runner-build-fingerprints.mjs';

const REQUIRED_SERVICES = [
  'artifactregistry.googleapis.com',
  'cloudscheduler.googleapis.com',
  'cloudresourcemanager.googleapis.com',
  'iam.googleapis.com',
  'iamcredentials.googleapis.com',
  'pubsub.googleapis.com',
  'run.googleapis.com',
  'serviceusage.googleapis.com',
  'storage.googleapis.com',
] as const;

const SERVICE_LABELS: Record<(typeof REQUIRED_SERVICES)[number], string> = {
  'artifactregistry.googleapis.com': 'Artifact Registry API',
  'cloudscheduler.googleapis.com': 'Cloud Scheduler API',
  'cloudresourcemanager.googleapis.com': 'Cloud Resource Manager API',
  'iam.googleapis.com': 'Identity and Access Management API',
  'iamcredentials.googleapis.com': 'IAM Service Account Credentials API',
  'pubsub.googleapis.com': 'Pub/Sub API',
  'run.googleapis.com': 'Cloud Run Admin API',
  'serviceusage.googleapis.com': 'Service Usage API',
  'storage.googleapis.com': 'Cloud Storage API',
};

const REPOSITORIES = [
  {
    description: 'Playrunner AI agent runner images',
    id: 'agent-runner',
  },
  {
    description: 'Playrunner orchestrator runner images',
    id: 'orchestrator',
  },
  {
    description: 'Playrunner browser runner images',
    id: 'playwright-runner',
  },
] as const;

const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const REGION_PATTERN = /^[a-z][a-z0-9-]{1,62}$/;
const SERVICE_ACCOUNT_ID = 'playrunner-scheduler';
const AGENT_SERVICE_ACCOUNT_ID = 'playrunner-agent-runner';
const AGENT_CONTROL_SERVICE_ACCOUNT_ID = 'playrunner-agent-control';
const ORCHESTRATOR_RUNTIME_SERVICE_ACCOUNT_ID =
  'playrunner-orchestrator-runtime';
const TOPIC_NAME = 'playrunner-workflow-events';

type GoogleOperation = {
  done?: boolean;
  error?: {
    code?: number;
    message?: string;
  };
  name?: string;
};

type GoogleErrorResponse = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

export type GcpProvisioningStep = {
  detail: string;
  id:
    | 'permissions'
    | 'services'
    | 'repositories'
    | 'pubsub'
    | 'scheduler'
    | 'agent'
    | 'orchestrator'
    | 'images';
  label: string;
  items?: GcpProvisioningStepItem[];
  state: 'complete' | 'failed' | 'warning';
};

export type GcpProvisioningStepItem = {
  detail?: string;
  label: string;
  state: 'complete' | 'failed' | 'warning';
  value?: string;
};

export type GcpProvisioningResult = {
  imageCommand: string;
  missingRuntimePermissions: string[];
  projectId: string;
  ready: boolean;
  region: string;
  steps: GcpProvisioningStep[];
  updatedAt: string;
};

export class GcpProvisioningError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly steps: GcpProvisioningStep[],
    readonly missingPermissions: string[] = [],
  ) {
    super(message);
    this.name = 'GcpProvisioningError';
  }
}

async function readGoogleResponse<T>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as
    | T
    | GoogleErrorResponse;
  if (response.ok) return data as T;

  const googleError = (data as GoogleErrorResponse).error;
  const message =
    googleError?.message ||
    `${fallbackMessage} (${response.status} ${response.statusText})`;
  throw Object.assign(new Error(message), {
    statusCode: response.status,
  });
}

async function googleRequest<T>(
  url: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  return readGoogleResponse<T>(response, 'Google Cloud request failed');
}

async function waitForOperation(
  operation: GoogleOperation,
  accessToken: string,
  apiOrigin: string,
): Promise<void> {
  if (operation.done) {
    if (operation.error?.message) throw new Error(operation.error.message);
    return;
  }
  if (!operation.name) return;

  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const current = await googleRequest<GoogleOperation>(
      `${apiOrigin}/v1/${operation.name}`,
      accessToken,
    );
    if (!current.done) continue;
    if (current.error?.message) throw new Error(current.error.message);
    return;
  }

  throw new Error(`Timed out waiting for Google operation ${operation.name}.`);
}

async function getProjectNumber(
  projectId: string,
  accessToken: string,
): Promise<string> {
  const project = await googleRequest<{ projectNumber?: string }>(
    `https://cloudresourcemanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}`,
    accessToken,
  );
  if (!project.projectNumber) {
    throw new Error(`Google Cloud did not return a number for ${projectId}.`);
  }
  return project.projectNumber;
}

async function enableServices(
  projectNumber: string,
  accessToken: string,
): Promise<void> {
  const operation = await googleRequest<GoogleOperation>(
    `https://serviceusage.googleapis.com/v1/projects/${projectNumber}/services:batchEnable`,
    accessToken,
    {
      body: JSON.stringify({ serviceIds: REQUIRED_SERVICES }),
      method: 'POST',
    },
  );
  await waitForOperation(
    operation,
    accessToken,
    'https://serviceusage.googleapis.com',
  );
}

async function ensureRepository(
  projectId: string,
  region: string,
  accessToken: string,
  repository: (typeof REPOSITORIES)[number],
): Promise<'created' | 'existing'> {
  const repositoryName = `projects/${projectId}/locations/${region}/repositories/${repository.id}`;
  const getUrl = `https://artifactregistry.googleapis.com/v1/${repositoryName}`;
  const existing = await fetch(getUrl, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (existing.ok) return 'existing';
  if (existing.status !== 404) {
    await readGoogleResponse(existing, `Failed to inspect ${repository.id}`);
  }

  const response = await fetch(
    `https://artifactregistry.googleapis.com/v1/projects/${projectId}/locations/${region}/repositories?repositoryId=${repository.id}`,
    {
      body: JSON.stringify({
        description: repository.description,
        format: 'DOCKER',
        labels: { managed_by: 'playrunner' },
      }),
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    },
  );
  if (response.status === 409) return 'existing';
  const operation = await readGoogleResponse<GoogleOperation>(
    response,
    `Failed to create ${repository.id}`,
  );
  await waitForOperation(
    operation,
    accessToken,
    'https://artifactregistry.googleapis.com',
  );
  return 'created';
}

async function ensureTopic(
  projectId: string,
  accessToken: string,
): Promise<'created' | 'existing'> {
  const topicUrl = `https://pubsub.googleapis.com/v1/projects/${projectId}/topics/${TOPIC_NAME}`;
  const existing = await fetch(topicUrl, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (existing.ok) return 'existing';
  if (existing.status !== 404) {
    await readGoogleResponse(existing, 'Failed to inspect Pub/Sub topic');
  }

  const response = await fetch(topicUrl, {
    body: JSON.stringify({ labels: { managed_by: 'playrunner' } }),
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    method: 'PUT',
  });
  if (response.status === 409) return 'existing';
  await readGoogleResponse(response, 'Failed to create Pub/Sub topic');
  return 'created';
}

async function ensureSchedulerServiceAccount(
  projectId: string,
  accessToken: string,
): Promise<'created' | 'existing'> {
  const email = `${SERVICE_ACCOUNT_ID}@${projectId}.iam.gserviceaccount.com`;
  const getUrl = `https://iam.googleapis.com/v1/projects/${projectId}/serviceAccounts/${email}`;
  const existing = await fetch(getUrl, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (existing.ok) return 'existing';
  if (existing.status !== 404) {
    await readGoogleResponse(
      existing,
      'Failed to inspect scheduler service account',
    );
  }

  const response = await fetch(
    `https://iam.googleapis.com/v1/projects/${projectId}/serviceAccounts`,
    {
      body: JSON.stringify({
        accountId: SERVICE_ACCOUNT_ID,
        serviceAccount: {
          description:
            'Used by Cloud Scheduler to call Playrunner schedule endpoints with OIDC.',
          displayName: 'Playrunner Cloud Scheduler',
        },
      }),
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    },
  );
  if (response.status === 409) return 'existing';
  await readGoogleResponse(response, 'Failed to create scheduler account');
  return 'created';
}

async function ensureAgentServiceAccount(
  projectId: string,
  accessToken: string,
): Promise<'created' | 'existing'> {
  const email = `${AGENT_SERVICE_ACCOUNT_ID}@${projectId}.iam.gserviceaccount.com`;
  const getUrl = `https://iam.googleapis.com/v1/projects/${projectId}/serviceAccounts/${email}`;
  const existing = await fetch(getUrl, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (existing.ok) return 'existing';
  if (existing.status !== 404) {
    await readGoogleResponse(
      existing,
      'Failed to inspect AI Container runner service account',
    );
  }

  const response = await fetch(
    `https://iam.googleapis.com/v1/projects/${projectId}/serviceAccounts`,
    {
      body: JSON.stringify(createAgentServiceAccountRequest()),
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    },
  );
  if (response.status === 409) return 'existing';
  await readGoogleResponse(
    response,
    'Failed to create AI Container runner account',
  );
  return 'created';
}

async function ensureServiceAccount(args: {
  accessToken: string;
  accountId: string;
  description: string;
  displayName: string;
  projectId: string;
}): Promise<'created' | 'existing'> {
  const email = `${args.accountId}@${args.projectId}.iam.gserviceaccount.com`;
  const resourceUrl = `https://iam.googleapis.com/v1/projects/${args.projectId}/serviceAccounts/${email}`;
  const existing = await fetch(resourceUrl, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${args.accessToken}`,
    },
  });
  if (existing.ok) return 'existing';
  if (existing.status !== 404) {
    await readGoogleResponse(existing, `Failed to inspect ${args.displayName}`);
  }
  const response = await fetch(
    `https://iam.googleapis.com/v1/projects/${args.projectId}/serviceAccounts`,
    {
      body: JSON.stringify({
        accountId: args.accountId,
        serviceAccount: {
          description: args.description,
          displayName: args.displayName,
        },
      }),
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${args.accessToken}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    },
  );
  if (response.status === 409) return 'existing';
  await readGoogleResponse(response, `Failed to create ${args.displayName}`);
  return 'created';
}

type IamPolicy = {
  bindings?: Array<{
    condition?: unknown;
    members?: string[];
    role?: string;
  }>;
  etag?: string;
  version?: number;
};

export function withAgentControlTokenCreator(
  policy: IamPolicy | null | undefined,
  orchestratorRuntimeEmail: string,
): IamPolicy {
  const member = `serviceAccount:${orchestratorRuntimeEmail}`;
  const bindings = (policy?.bindings || [])
    .map((binding) => ({
      ...binding,
      members: (binding.members || []).filter(
        (candidate) =>
          candidate !== 'allUsers' &&
          candidate !== 'allAuthenticatedUsers' &&
          candidate !== member,
      ),
    }))
    .filter((binding) => binding.members.length > 0);
  let tokenCreators = bindings.find(
    (binding) =>
      binding.role === 'roles/iam.serviceAccountTokenCreator' &&
      binding.condition === undefined,
  );
  if (!tokenCreators) {
    tokenCreators = {
      members: [],
      role: 'roles/iam.serviceAccountTokenCreator',
    };
    bindings.push(tokenCreators);
  }
  tokenCreators.members = Array.from(
    new Set([...(tokenCreators.members || []), member]),
  );
  return { ...(policy || {}), bindings };
}

async function ensureAgentControlIdentities(
  projectId: string,
  accessToken: string,
): Promise<{
  control: 'created' | 'existing';
  controlEmail: string;
  runtime: 'created' | 'existing';
  runtimeEmail: string;
}> {
  const runtimeEmail = `${ORCHESTRATOR_RUNTIME_SERVICE_ACCOUNT_ID}@${projectId}.iam.gserviceaccount.com`;
  const controlEmail = `${AGENT_CONTROL_SERVICE_ACCOUNT_ID}@${projectId}.iam.gserviceaccount.com`;
  const [runtime, control] = await Promise.all([
    ensureServiceAccount({
      accessToken,
      accountId: ORCHESTRATOR_RUNTIME_SERVICE_ACCOUNT_ID,
      description:
        'Roleless runtime identity for the Playrunner orchestrator Cloud Run service.',
      displayName: 'Playrunner Orchestrator Runtime',
      projectId,
    }),
    ensureServiceAccount({
      accessToken,
      accountId: AGENT_CONTROL_SERVICE_ACCOUNT_ID,
      description:
        'Short-lived Pub/Sub control identity for Playrunner AI Container jobs. It is never assigned as the job runtime identity.',
      displayName: 'Playrunner AI Container Control',
      projectId,
    }),
  ]);
  const policyUrl = `https://iam.googleapis.com/v1/projects/${projectId}/serviceAccounts/${controlEmail}`;
  const currentPolicy = await googleRequest<IamPolicy>(
    `${policyUrl}:getIamPolicy`,
    accessToken,
    {
      body: JSON.stringify({ options: { requestedPolicyVersion: 3 } }),
      method: 'POST',
    },
  );
  const updatedPolicy = await googleRequest<IamPolicy>(
    `${policyUrl}:setIamPolicy`,
    accessToken,
    {
      body: JSON.stringify({
        policy: withAgentControlTokenCreator(currentPolicy, runtimeEmail),
      }),
      method: 'POST',
    },
  );
  const runtimeMember = `serviceAccount:${runtimeEmail}`;
  const runtimeBindings = (updatedPolicy.bindings || []).filter((binding) =>
    (binding.members || []).includes(runtimeMember),
  );
  if (
    runtimeBindings.length !== 1 ||
    runtimeBindings[0].role !== 'roles/iam.serviceAccountTokenCreator' ||
    runtimeBindings[0].condition !== undefined
  ) {
    throw new Error(
      'IAM did not apply the exact Agent control token-creator binding.',
    );
  }
  return { control, controlEmail, runtime, runtimeEmail };
}

export function createAgentServiceAccountRequest(): Record<string, unknown> {
  return {
    accountId: AGENT_SERVICE_ACCOUNT_ID,
    serviceAccount: {
      description:
        'Dedicated runtime identity for isolated Playrunner AI Container Cloud Run jobs. Playrunner does not add IAM role bindings.',
      displayName: 'Playrunner AI Container Runner',
    },
  };
}

type ArtifactRegistryImage = {
  name?: string;
  tags?: string[];
  uploadTime?: string;
  uri?: string;
};

async function listRepositoryImages(
  projectId: string,
  region: string,
  repository: (typeof REPOSITORIES)[number],
  accessToken: string,
): Promise<ArtifactRegistryImage[]> {
  const images: ArtifactRegistryImage[] = [];
  let pageToken = '';
  do {
    const url = new URL(
      `https://artifactregistry.googleapis.com/v1/projects/${projectId}/locations/${region}/repositories/${repository.id}/dockerImages`,
    );
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const result = await googleRequest<{
      dockerImages?: ArtifactRegistryImage[];
      nextPageToken?: string;
    }>(url.toString(), accessToken);
    images.push(...(result.dockerImages || []));
    pageToken = result.nextPageToken || '';
  } while (pageToken);
  return images;
}

function completeStep(
  id: GcpProvisioningStep['id'],
  label: string,
  detail: string,
  items?: GcpProvisioningStepItem[],
): GcpProvisioningStep {
  return { detail, id, items, label, state: 'complete' };
}

function replaceTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, value),
    template,
  );
}

function imageNameFromReference(reference: string): string {
  const lastSlash = reference.lastIndexOf('/');
  const lastColon = reference.lastIndexOf(':');
  return lastColon > lastSlash ? reference.slice(0, lastColon) : reference;
}

function imageHasTags(
  image: ArtifactRegistryImage,
  requiredTags: string[],
): boolean {
  const tags = new Set(image.tags || []);
  const digestImageName = image.uri?.split('@')[0];
  return requiredTags.every((reference) => {
    if (
      digestImageName &&
      digestImageName !== imageNameFromReference(reference)
    )
      return false;
    const lastSlash = reference.lastIndexOf('/');
    const lastColon = reference.lastIndexOf(':');
    const shortTag =
      lastColon > lastSlash ? reference.slice(lastColon + 1) : reference;
    return tags.has(reference) || tags.has(shortTag);
  });
}

async function expectedRunnerImages(args: {
  agentImageUriTemplate: string;
  basePath?: string;
  orchestratorImageUriTemplate: string;
  playwrightImageUriTemplate: string;
  projectId: string;
}) {
  const repoRoot =
    process.env.PLAYRUNNER_REPO_ROOT?.trim() ||
    (await findPlayrunnerRepoRoot(process.cwd()));
  if (!repoRoot) return null;

  const fingerprints = await getRunnerBuildFingerprints({
    basePath: args.basePath || '.',
    repoRoot,
  });
  const agentReference = replaceTemplate(args.agentImageUriTemplate, {
    projectId: args.projectId,
  });
  const agentImageName = imageNameFromReference(agentReference);
  const orchestratorReference = replaceTemplate(
    args.orchestratorImageUriTemplate,
    { projectId: args.projectId },
  );
  const orchestratorImageName = imageNameFromReference(orchestratorReference);
  const expected = [
    {
      fingerprint: fingerprints.agent.fingerprint,
      label: 'Agent',
      repositoryId: 'agent-runner',
      requiredTags: [
        agentReference,
        `${agentImageName}:build-${fingerprints.agent.fingerprint}`,
      ],
      value: agentReference,
    },
    {
      fingerprint: fingerprints.orchestrator.fingerprint,
      label: 'Orchestrator',
      repositoryId: 'orchestrator',
      requiredTags: [
        orchestratorReference,
        `${orchestratorImageName}:build-${fingerprints.orchestrator.fingerprint}`,
      ],
      value: orchestratorReference,
    },
  ];

  for (const playwright of fingerprints.playwright) {
    const versionReference = replaceTemplate(args.playwrightImageUriTemplate, {
      projectId: args.projectId,
      runtime: playwright.runtime,
      version: playwright.version,
    });
    const imageName = imageNameFromReference(versionReference);
    const requiredTags = [
      versionReference,
      `${imageName}:build-${playwright.fingerprint}`,
    ];
    if (playwright.publishAsLatest) {
      requiredTags.push(
        replaceTemplate(args.playwrightImageUriTemplate, {
          projectId: args.projectId,
          runtime: playwright.runtime,
          version: 'latest',
        }),
      );
    }
    expected.push({
      fingerprint: playwright.fingerprint,
      label: `Playwright ${playwright.runtime} ${playwright.version}`,
      repositoryId: 'playwright-runner',
      requiredTags,
      value: versionReference,
    });
  }
  return expected;
}

function imageFreshnessItem(
  expected: NonNullable<
    Awaited<ReturnType<typeof expectedRunnerImages>>
  >[number],
  images: ArtifactRegistryImage[],
): GcpProvisioningStepItem {
  const matchingImage = images.find((image) =>
    imageHasTags(image, expected.requiredTags),
  );
  if (matchingImage) {
    return {
      detail: [
        `Local fingerprint ${expected.fingerprint}.`,
        matchingImage.uri ? `Cloud digest ${matchingImage.uri}.` : '',
        matchingImage.uploadTime ? `Uploaded ${matchingImage.uploadTime}.` : '',
      ]
        .filter(Boolean)
        .join(' '),
      label: expected.label,
      state: 'complete',
      value: expected.value,
    };
  }

  const normalTagExists = images.some((image) =>
    imageHasTags(image, [expected.requiredTags[0]]),
  );
  return {
    detail: normalTagExists
      ? `The cloud tag exists, but it does not match local fingerprint ${expected.fingerprint}. Rebuild and push this runner.`
      : `No cloud image matches local fingerprint ${expected.fingerprint}. Build and push this runner.`,
    label: expected.label,
    state: 'warning',
    value: expected.value,
  };
}

export async function provisionGcpCloudRunners(args: {
  accessToken: string;
  agentImageUriTemplate?: string;
  basePath?: string;
  orchestratorImageUriTemplate?: string;
  playwrightImageUriTemplate?: string;
  projectId: string;
  region: string;
}): Promise<GcpProvisioningResult> {
  const projectId = args.projectId.trim();
  const region = args.region.trim();
  const steps: GcpProvisioningStep[] = [];
  const permissionItems: GcpProvisioningStepItem[] = [];
  const imageCommand =
    './infra/gcp/scripts/push-runners.sh --target both --yes';
  const agentImageUriTemplate =
    args.agentImageUriTemplate?.trim() ||
    `${region}-docker.pkg.dev/{projectId}/agent-runner/playrunner-agent-runner:latest`;
  const orchestratorImageUriTemplate =
    args.orchestratorImageUriTemplate?.trim() ||
    `${region}-docker.pkg.dev/{projectId}/orchestrator/playrunner-orchestrator:latest`;
  const playwrightImageUriTemplate =
    args.playwrightImageUriTemplate?.trim() ||
    `${region}-docker.pkg.dev/{projectId}/playwright-runner/playrunner-playwright-runner-{runtime}:{version}`;
  let activeStep: Pick<GcpProvisioningStep, 'id' | 'label'> = {
    id: 'permissions',
    label: 'Resource access',
  };

  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new GcpProvisioningError(
      'The saved Google Cloud project ID is invalid.',
      400,
      steps,
    );
  }
  if (!REGION_PATTERN.test(region)) {
    throw new GcpProvisioningError(
      'The saved Google Cloud region is invalid.',
      400,
      steps,
    );
  }

  try {
    const projectNumber = await getProjectNumber(projectId, args.accessToken);
    permissionItems.push({
      detail: 'Read the selected project and resolved its project number.',
      label: 'Project access',
      state: 'complete',
      value: `projects/${projectId}`,
    });

    activeStep = { id: 'services', label: 'Google Cloud APIs' };
    await enableServices(projectNumber, args.accessToken);
    permissionItems.push({
      detail:
        'The required APIs were enabled or confirmed through Service Usage.',
      label: 'Service Usage access',
      state: 'complete',
      value: `projects/${projectNumber}`,
    });
    steps.push(
      completeStep(
        'services',
        'Google Cloud APIs',
        `${REQUIRED_SERVICES.length} required APIs are enabled.`,
        REQUIRED_SERVICES.map((service) => ({
          detail: 'Enabled in the selected project.',
          label: SERVICE_LABELS[service],
          state: 'complete',
          value: service,
        })),
      ),
    );

    activeStep = { id: 'repositories', label: 'Artifact Registry' };
    const repositoryResults = await Promise.all(
      REPOSITORIES.map((repository) =>
        ensureRepository(projectId, region, args.accessToken, repository),
      ),
    );
    REPOSITORIES.forEach((repository, index) => {
      const result = repositoryResults[index];
      permissionItems.push({
        detail:
          result === 'created'
            ? 'Created this repository through the repository resource API.'
            : 'Read this repository through the repository resource API.',
        label: `${repository.id} repository access`,
        state: 'complete',
        value: `projects/${projectId}/locations/${region}/repositories/${repository.id}`,
      });
    });
    steps.push(
      completeStep(
        'repositories',
        'Artifact Registry',
        'Agent, Orchestrator, and Playwright repositories are ready.',
        REPOSITORIES.map((repository) => ({
          detail: repository.description,
          label: repository.id,
          state: 'complete',
          value: `projects/${projectId}/locations/${region}/repositories/${repository.id}`,
        })),
      ),
    );

    activeStep = { id: 'agent', label: 'AI Container identity' };
    const agentIdentityResult = await ensureAgentServiceAccount(
      projectId,
      args.accessToken,
    );
    const agentServiceAccountEmail = `${AGENT_SERVICE_ACCOUNT_ID}@${projectId}.iam.gserviceaccount.com`;
    permissionItems.push({
      detail:
        agentIdentityResult === 'created'
          ? 'Created a dedicated runtime identity without adding IAM role bindings.'
          : 'Read the dedicated runtime identity; Playrunner does not add IAM role bindings.',
      label: 'AI Container service account access',
      state: 'complete',
      value: agentServiceAccountEmail,
    });
    steps.push(
      completeStep(
        'agent',
        'AI Container identity',
        `${agentServiceAccountEmail} is ready. Playrunner grants it no project roles.`,
        [
          {
            detail:
              'Cloud Run uses this dedicated identity for generated code. Playrunner adds no role bindings; runner control uses a separate short-lived scoped identity and artifact access uses the execution-authenticated API. User-managed IAM grants remain the project owner’s responsibility.',
            label: 'Playrunner AI Container Runner',
            state: 'complete',
            value: agentServiceAccountEmail,
          },
        ],
      ),
    );

    activeStep = {
      id: 'orchestrator',
      label: 'Private orchestration identities',
    };
    const orchestrationIdentities = await ensureAgentControlIdentities(
      projectId,
      args.accessToken,
    );
    permissionItems.push({
      detail:
        'Reconciled the roleless orchestrator runtime identity and its permission to mint short-lived tokens for the separate AI control identity.',
      label: 'Orchestrator identity access',
      state: 'complete',
      value: orchestrationIdentities.runtimeEmail,
    });
    steps.push(
      completeStep(
        'orchestrator',
        'Private orchestration identities',
        'Dedicated runtime and short-lived AI control identities are ready.',
        [
          {
            detail:
              'Runs the orchestrator without project-level roles. It can mint tokens only for the dedicated AI control identity.',
            label: 'Orchestrator runtime',
            state: 'complete',
            value: orchestrationIdentities.runtimeEmail,
          },
          {
            detail:
              'Never runs generated code. At execution time Playrunner grants it only topic publisher and that execution’s control-subscription subscriber access; inherited user-managed grants remain the project owner’s responsibility.',
            label: 'AI Container control',
            state: 'complete',
            value: orchestrationIdentities.controlEmail,
          },
        ],
      ),
    );

    activeStep = { id: 'pubsub', label: 'Pub/Sub transport' };
    const topicResult = await ensureTopic(projectId, args.accessToken);
    permissionItems.push({
      detail:
        topicResult === 'created'
          ? 'Created the topic through the Pub/Sub topic resource API.'
          : 'Read the topic through the Pub/Sub topic resource API.',
      label: 'Pub/Sub topic access',
      state: 'complete',
      value: `projects/${projectId}/topics/${TOPIC_NAME}`,
    });
    steps.push(
      completeStep('pubsub', 'Pub/Sub transport', `${TOPIC_NAME} is ready.`, [
        {
          detail: 'Shared transport for workflow and runner events.',
          label: TOPIC_NAME,
          state: 'complete',
          value: `projects/${projectId}/topics/${TOPIC_NAME}`,
        },
      ]),
    );

    activeStep = { id: 'scheduler', label: 'Scheduler identity' };
    const schedulerResult = await ensureSchedulerServiceAccount(
      projectId,
      args.accessToken,
    );
    permissionItems.push({
      detail:
        schedulerResult === 'created'
          ? 'Created the identity through the service-account resource API.'
          : 'Read the identity through the service-account resource API.',
      label: 'Service account access',
      state: 'complete',
      value: `${SERVICE_ACCOUNT_ID}@${projectId}.iam.gserviceaccount.com`,
    });
    steps.push(
      completeStep(
        'scheduler',
        'Scheduler identity',
        `${SERVICE_ACCOUNT_ID}@${projectId}.iam.gserviceaccount.com is ready.`,
        [
          {
            detail:
              'Used by Cloud Scheduler to call Playrunner schedule endpoints with OIDC.',
            label: 'Playrunner Cloud Scheduler',
            state: 'complete',
            value: `${SERVICE_ACCOUNT_ID}@${projectId}.iam.gserviceaccount.com`,
          },
        ],
      ),
    );

    activeStep = { id: 'images', label: 'Runner images' };
    const repositoryImages = new Map<string, ArtifactRegistryImage[]>(
      await Promise.all(
        REPOSITORIES.map(
          async (repository) =>
            [
              repository.id,
              await listRepositoryImages(
                projectId,
                region,
                repository,
                args.accessToken,
              ),
            ] as const,
        ),
      ),
    );
    permissionItems.push({
      detail:
        'Listed Docker images in all runner repositories through Artifact Registry.',
      label: 'Runner image access',
      state: 'complete',
      value: `projects/${projectId}/locations/${region}`,
    });

    const expectedImages = await expectedRunnerImages({
      agentImageUriTemplate,
      basePath: args.basePath,
      orchestratorImageUriTemplate,
      playwrightImageUriTemplate,
      projectId,
    });
    const imageItems: GcpProvisioningStepItem[] = expectedImages
      ? expectedImages.map((expected) =>
          imageFreshnessItem(
            expected,
            repositoryImages.get(expected.repositoryId) || [],
          ),
        )
      : [
          {
            detail:
              'The API could not locate the local Playrunner checkout, so it could not calculate build fingerprints. Set PLAYRUNNER_REPO_ROOT for the API process.',
            label: 'Local build fingerprints',
            state: 'warning',
          },
        ];
    const imagesReady =
      expectedImages !== null &&
      imageItems.length > 0 &&
      imageItems.every((item) => item.state === 'complete');

    steps.unshift(
      completeStep(
        'permissions',
        'Resource access',
        'Access was validated by successful operations against the selected project and its actual resources. Runtime-only access is evaluated by Google when each workflow resource is used.',
        permissionItems,
      ),
    );
    steps.push(
      imagesReady
        ? completeStep(
            'images',
            'Runner images',
            'All required runner images match the current local build fingerprints.',
            imageItems,
          )
        : {
            detail:
              'One or more runner images are missing or out of date. Rebuild and push the runners, then recheck setup.',
            id: 'images',
            items: imageItems,
            label: 'Runner images',
            state: 'warning',
          },
    );

    return {
      imageCommand,
      missingRuntimePermissions: [],
      projectId,
      ready: imagesReady,
      region,
      steps,
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof GcpProvisioningError) throw error;
    const message =
      error instanceof Error ? error.message : 'GCP provisioning failed.';
    const statusCode =
      typeof (error as { statusCode?: unknown })?.statusCode === 'number'
        ? ((error as { statusCode: number }).statusCode ?? 500)
        : 500;

    if (!steps.some((step) => step.id === activeStep.id)) {
      steps.push({
        detail: message,
        id: activeStep.id,
        label: activeStep.label,
        state: 'failed',
      });
    }
    if (
      (statusCode === 401 || statusCode === 403) &&
      !steps.some((step) => step.id === 'permissions')
    ) {
      steps.unshift({
        detail:
          'Google denied an operation against the selected project or resource. Expand the failed resource below for the exact API error.',
        id: 'permissions',
        items: [
          ...permissionItems,
          {
            detail: message,
            label: `${activeStep.label} access`,
            state: 'failed',
          },
        ],
        label: 'Resource access',
        state: 'failed',
      });
    }
    throw new GcpProvisioningError(message, statusCode, steps);
  }
}
