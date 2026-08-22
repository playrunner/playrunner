import { ServicesClient } from '@google-cloud/run';
import { OAuth2Client } from 'google-auth-library';

type OrchestratorCloudRunConfig = {
  callerServiceAccountEmail: string;
  callerServiceAccountSubject: string;
  cpuIdle: boolean;
  editorApiUrl: string;
  maxInstanceCount: number;
  minInstanceCount: number;
  runtimeServiceAccountEmail: string;
  serviceName: string;
};

export interface GcpCloudRunSettings {
  cloudRunLocation?: string;
  editorApiUrl?: string;
  orchestratorCpuIdle?: boolean;
  orchestratorCallerServiceAccountEmail?: string;
  orchestratorCallerServiceAccountSubject?: string;
  orchestratorImageUriTemplate?: string;
  orchestratorMaxInstanceCount?: number | string;
  orchestratorMinInstanceCount?: number | string;
  orchestratorRuntimeServiceAccountEmail?: string;
  orchestratorServiceName?: string;
}

const EDITOR_API_URL_ENVIRONMENT_KEY = 'EDITOR_API_URL';
const ORCHESTRATOR_AUTH_MODE_ENVIRONMENT_KEY =
  'PLAYRUNNER_ORCHESTRATOR_AUTH_MODE';
const ORCHESTRATOR_AUTH_MODE = 'gcp_identity';
const ORCHESTRATOR_IDENTITY_AUDIENCE_ENVIRONMENT_KEY =
  'PLAYRUNNER_ORCHESTRATOR_IDENTITY_AUDIENCE';
const ORCHESTRATOR_CALLER_EMAIL_ENVIRONMENT_KEY =
  'PLAYRUNNER_ORCHESTRATOR_CALLER_SERVICE_ACCOUNT_EMAIL';
const ORCHESTRATOR_CALLER_SUBJECT_ENVIRONMENT_KEY =
  'PLAYRUNNER_ORCHESTRATOR_CALLER_SERVICE_ACCOUNT_SUBJECT';
const PUBLIC_IAM_MEMBERS = new Set(['allAuthenticatedUsers', 'allUsers']);

export type OrchestratorCallerIdentity = {
  email: string;
  subject: string;
};

function requireSetting(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${name} must be configured in GCP settings.`);
  }
  return normalized;
}

function requirePositiveIntegerSetting(value: unknown, name: string): number {
  const numberValue =
    typeof value === 'string' && value.trim()
      ? Number(value)
      : typeof value === 'number'
        ? value
        : NaN;
  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    throw new Error(
      `${name} must be configured as a positive integer in GCP runner settings.`,
    );
  }
  return numberValue;
}

function requireBooleanSetting(value: unknown, name: string): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string' && value.trim().toLowerCase() === 'true') {
    return true;
  }
  if (typeof value === 'string' && value.trim().toLowerCase() === 'false') {
    return false;
  }
  throw new Error(
    `${name} must be configured as true or false in GCP runner settings.`,
  );
}

export function normalizeGcpEditorApiOrigin(value: string | undefined): string {
  const configured = value?.trim();
  if (!configured) {
    throw new Error(
      'PLAYRUNNER_PUBLIC_API_URL must be configured before using GCP runners.',
    );
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error('PLAYRUNNER_PUBLIC_API_URL must be a valid HTTPS URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error(
      'PLAYRUNNER_PUBLIC_API_URL must be a credential-free HTTPS URL.',
    );
  }
  return url.origin;
}

export function withOrchestratorEditorApiEnvironment(
  environment: ReadonlyArray<Record<string, unknown>> | undefined,
  editorApiUrl: string,
): Array<Record<string, unknown>> {
  return [
    ...(environment || []).filter(
      (entry) => entry.name !== EDITOR_API_URL_ENVIRONMENT_KEY,
    ),
    { name: EDITOR_API_URL_ENVIRONMENT_KEY, value: editorApiUrl },
  ];
}

function requireCallerServiceAccountEmail(value: string | undefined): string {
  const email = value?.trim().toLowerCase() || '';
  if (
    email.length > 254 ||
    !/^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?@[a-z0-9][a-z0-9.-]*\.iam\.gserviceaccount\.com$/.test(
      email,
    )
  ) {
    throw new Error(
      'PLAYRUNNER_GCP_ORCHESTRATOR_CALLER_SERVICE_ACCOUNT_EMAIL must name the server-owned API service account used by Application Default Credentials.',
    );
  }
  return email;
}

function requireCallerServiceAccountSubject(value: string | undefined): string {
  const subject = value?.trim() || '';
  if (!/^\d{6,32}$/.test(subject)) {
    throw new Error(
      'PLAYRUNNER_GCP_ORCHESTRATOR_CALLER_SERVICE_ACCOUNT_SUBJECT must be the numeric unique ID of the server-owned API service account.',
    );
  }
  return subject;
}

function normalizeOrchestratorServiceUri(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Cloud Run returned an invalid orchestrator service URI.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Cloud Run returned an invalid orchestrator service URI.');
  }
  return url.origin;
}

export function withOrchestratorSecurityEnvironment(
  environment: ReadonlyArray<Record<string, unknown>> | undefined,
  {
    audience,
    caller,
    editorApiUrl,
  }: {
    audience: string;
    caller: OrchestratorCallerIdentity;
    editorApiUrl: string;
  },
): Array<Record<string, unknown>> {
  const managedKeys = new Set([
    EDITOR_API_URL_ENVIRONMENT_KEY,
    ORCHESTRATOR_AUTH_MODE_ENVIRONMENT_KEY,
    ORCHESTRATOR_IDENTITY_AUDIENCE_ENVIRONMENT_KEY,
    ORCHESTRATOR_CALLER_EMAIL_ENVIRONMENT_KEY,
    ORCHESTRATOR_CALLER_SUBJECT_ENVIRONMENT_KEY,
  ]);
  return [
    ...(environment || []).filter(
      (entry) => typeof entry.name !== 'string' || !managedKeys.has(entry.name),
    ),
    { name: EDITOR_API_URL_ENVIRONMENT_KEY, value: editorApiUrl },
    {
      name: ORCHESTRATOR_AUTH_MODE_ENVIRONMENT_KEY,
      value: ORCHESTRATOR_AUTH_MODE,
    },
    {
      name: ORCHESTRATOR_IDENTITY_AUDIENCE_ENVIRONMENT_KEY,
      value: audience,
    },
    {
      name: ORCHESTRATOR_CALLER_EMAIL_ENVIRONMENT_KEY,
      value: caller.email,
    },
    {
      name: ORCHESTRATOR_CALLER_SUBJECT_ENVIRONMENT_KEY,
      value: caller.subject,
    },
  ];
}

type IamPolicy = {
  auditConfigs?: unknown;
  bindings?: Array<{
    condition?: unknown;
    members?: string[];
    role?: string;
  }>;
  etag?: string | Uint8Array;
  version?: number;
};

export function withPrivateOrchestratorInvokerPolicy(
  policy: IamPolicy | null | undefined,
  callerServiceAccountEmail: string,
): IamPolicy {
  const caller = `serviceAccount:${requireCallerServiceAccountEmail(
    callerServiceAccountEmail,
  )}`;
  const bindings = (policy?.bindings || [])
    .map((binding) => ({
      ...binding,
      members: (binding.members || []).filter(
        (member) => !PUBLIC_IAM_MEMBERS.has(member) && member !== caller,
      ),
    }))
    .filter((binding) => binding.members.length > 0);
  let invokerBinding = bindings.find(
    (binding) =>
      binding.role === 'roles/run.invoker' && binding.condition === undefined,
  );
  if (!invokerBinding) {
    invokerBinding = { members: [], role: 'roles/run.invoker' };
    bindings.push(invokerBinding);
  }
  invokerBinding.members = Array.from(
    new Set([...(invokerBinding.members || []), caller]),
  );

  return {
    ...(policy || {}),
    bindings,
  };
}

export function orchestratorServiceUsesRuntimeIdentity(
  service: unknown,
  expectedServiceAccountEmail: string,
): boolean {
  if (!service || typeof service !== 'object' || Array.isArray(service)) {
    return false;
  }
  const template = (service as { template?: unknown }).template;
  return Boolean(
    template &&
    typeof template === 'object' &&
    !Array.isArray(template) &&
    (template as { serviceAccount?: unknown }).serviceAccount ===
      expectedServiceAccountEmail,
  );
}

function policyIsPrivateForCaller(
  policy: IamPolicy | null | undefined,
  callerServiceAccountEmail: string,
): boolean {
  const caller = `serviceAccount:${callerServiceAccountEmail}`;
  const bindings = policy?.bindings || [];
  const callerBindings = bindings.filter((binding) =>
    (binding.members || []).includes(caller),
  );
  return (
    bindings.every((binding) =>
      (binding.members || []).every(
        (member) => !PUBLIC_IAM_MEMBERS.has(member),
      ),
    ) &&
    callerBindings.length === 1 &&
    callerBindings[0].role === 'roles/run.invoker' &&
    callerBindings[0].condition === undefined
  );
}

async function ensurePrivateOrchestratorIamPolicy(
  servicesClient: ServicesClient,
  formattedServiceName: string,
  callerServiceAccountEmail: string,
): Promise<void> {
  const [currentPolicy] = await servicesClient.getIamPolicy({
    options: { requestedPolicyVersion: 3 },
    resource: formattedServiceName,
  });
  const desiredPolicy = withPrivateOrchestratorInvokerPolicy(
    currentPolicy as IamPolicy,
    callerServiceAccountEmail,
  );
  const [updatedPolicy] = (await servicesClient.setIamPolicy({
    policy: desiredPolicy as any,
    resource: formattedServiceName,
  })) as any;
  if (
    !policyIsPrivateForCaller(
      updatedPolicy as IamPolicy,
      callerServiceAccountEmail,
    )
  ) {
    throw new Error(
      'Cloud Run did not apply the private orchestrator invoker policy.',
    );
  }
}

export function getOrchestratorCloudRunConfig(
  settings: GcpCloudRunSettings,
): OrchestratorCloudRunConfig {
  const serviceName = requireSetting(
    settings.orchestratorServiceName,
    'Orchestrator service name',
  );
  const minInstanceCount = requirePositiveIntegerSetting(
    settings.orchestratorMinInstanceCount,
    'Orchestrator minimum instance count',
  );
  const maxInstanceCount = requirePositiveIntegerSetting(
    settings.orchestratorMaxInstanceCount,
    'Orchestrator maximum instance count',
  );

  if (maxInstanceCount < minInstanceCount) {
    throw new Error(
      'Orchestrator maximum instance count must be greater than or equal to the minimum instance count.',
    );
  }

  const cpuIdle = requireBooleanSetting(
    settings.orchestratorCpuIdle,
    'Orchestrator CPU idle policy',
  );
  if (cpuIdle) {
    throw new Error(
      'Orchestrator CPU idle policy must be false so detached workflows have always-allocated CPU after /execute responds.',
    );
  }

  return {
    callerServiceAccountEmail: requireCallerServiceAccountEmail(
      settings.orchestratorCallerServiceAccountEmail,
    ),
    callerServiceAccountSubject: requireCallerServiceAccountSubject(
      settings.orchestratorCallerServiceAccountSubject,
    ),
    cpuIdle,
    editorApiUrl: normalizeGcpEditorApiOrigin(settings.editorApiUrl),
    maxInstanceCount,
    minInstanceCount,
    runtimeServiceAccountEmail: requireCallerServiceAccountEmail(
      settings.orchestratorRuntimeServiceAccountEmail,
    ),
    serviceName,
  };
}

function renderTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, value),
    template,
  );
}

function getOrchestratorImageUri(projectId: string, template: string): string {
  return renderTemplate(template, { projectId });
}

export function assertDetachedOrchestratorServiceConfiguration(
  service: any,
): void {
  const minInstanceCount = Number(service?.scaling?.minInstanceCount ?? 0);
  const cpuIdle = service?.template?.containers?.[0]?.resources?.cpuIdle;
  if (!Number.isInteger(minInstanceCount) || minInstanceCount < 1) {
    throw new Error(
      'Cloud Run orchestrator must have at least one minimum instance for detached workflow execution.',
    );
  }
  if (cpuIdle !== false) {
    throw new Error(
      'Cloud Run orchestrator must use always-allocated CPU (cpuIdle=false) for detached workflow execution.',
    );
  }
}

async function ensureServiceConfiguration(
  servicesClient: ServicesClient,
  service: any,
  formattedServiceName: string,
  orchestratorConfig: OrchestratorCloudRunConfig,
  orchestratorImageUri: string,
): Promise<string> {
  const serviceUri = normalizeOrchestratorServiceUri(service.uri || '');
  const currentMinInstances = Number(service.scaling?.minInstanceCount || 0);
  const currentMaxInstances = Number(
    service.template?.scaling?.maxInstanceCount || 0,
  );
  const currentContainer = service.template?.containers?.[0];
  const currentImage = currentContainer?.image;
  const currentCpuIdle = currentContainer?.resources?.cpuIdle;
  const currentEditorApiEntries = Array.isArray(currentContainer?.env)
    ? currentContainer.env.filter(
        (entry: Record<string, unknown>) =>
          entry.name === EDITOR_API_URL_ENVIRONMENT_KEY,
      )
    : [];
  const desiredEnvironment = withOrchestratorSecurityEnvironment(
    currentContainer?.env,
    {
      audience: serviceUri,
      caller: {
        email: orchestratorConfig.callerServiceAccountEmail,
        subject: orchestratorConfig.callerServiceAccountSubject,
      },
      editorApiUrl: orchestratorConfig.editorApiUrl,
    },
  );
  const managedEnvironment = new Map(
    (Array.isArray(currentContainer?.env) ? currentContainer.env : [])
      .filter((entry: Record<string, unknown>) =>
        [
          EDITOR_API_URL_ENVIRONMENT_KEY,
          ORCHESTRATOR_AUTH_MODE_ENVIRONMENT_KEY,
          ORCHESTRATOR_IDENTITY_AUDIENCE_ENVIRONMENT_KEY,
          ORCHESTRATOR_CALLER_EMAIL_ENVIRONMENT_KEY,
          ORCHESTRATOR_CALLER_SUBJECT_ENVIRONMENT_KEY,
        ].includes(String(entry.name)),
      )
      .map((entry: Record<string, unknown>) => [entry.name, entry.value]),
  );
  const shouldUpdateMinInstances =
    currentMinInstances !== orchestratorConfig.minInstanceCount;
  const shouldUpdateMaxInstances =
    currentMaxInstances !== orchestratorConfig.maxInstanceCount;
  const shouldUpdateImage = currentImage !== orchestratorImageUri;
  const shouldUpdateCpuAllocation =
    currentCpuIdle !== orchestratorConfig.cpuIdle;
  const shouldUpdateEditorApiUrl =
    currentEditorApiEntries.length !== 1 ||
    currentEditorApiEntries[0]?.value !== orchestratorConfig.editorApiUrl;
  const shouldUpdateSecurityEnvironment =
    shouldUpdateEditorApiUrl ||
    managedEnvironment.size !== 5 ||
    managedEnvironment.get(ORCHESTRATOR_AUTH_MODE_ENVIRONMENT_KEY) !==
      ORCHESTRATOR_AUTH_MODE ||
    managedEnvironment.get(ORCHESTRATOR_IDENTITY_AUDIENCE_ENVIRONMENT_KEY) !==
      serviceUri ||
    managedEnvironment.get(ORCHESTRATOR_CALLER_EMAIL_ENVIRONMENT_KEY) !==
      orchestratorConfig.callerServiceAccountEmail ||
    managedEnvironment.get(ORCHESTRATOR_CALLER_SUBJECT_ENVIRONMENT_KEY) !==
      orchestratorConfig.callerServiceAccountSubject;
  const shouldEnableInvokerIamCheck = service.invokerIamDisabled === true;
  const shouldUpdateRuntimeServiceAccount =
    !orchestratorServiceUsesRuntimeIdentity(
      service,
      orchestratorConfig.runtimeServiceAccountEmail,
    );

  if (
    !shouldUpdateMinInstances &&
    !shouldUpdateMaxInstances &&
    !shouldUpdateImage &&
    !shouldUpdateCpuAllocation &&
    !shouldUpdateSecurityEnvironment &&
    !shouldUpdateRuntimeServiceAccount &&
    !shouldEnableInvokerIamCheck
  ) {
    assertDetachedOrchestratorServiceConfiguration(service);
    return serviceUri;
  }

  const update: Record<string, any> = {
    name: formattedServiceName,
  };
  const paths: string[] = [];

  if (shouldEnableInvokerIamCheck) {
    update.invokerIamDisabled = false;
    paths.push('invoker_iam_disabled');
  }

  if (shouldUpdateMinInstances) {
    update.scaling = {
      ...(service.scaling || {}),
      minInstanceCount: orchestratorConfig.minInstanceCount,
    };
    paths.push('scaling.min_instance_count');
  }

  if (
    shouldUpdateMaxInstances ||
    shouldUpdateImage ||
    shouldUpdateCpuAllocation ||
    shouldUpdateSecurityEnvironment ||
    shouldUpdateRuntimeServiceAccount
  ) {
    update.template = {
      ...(service.template || {}),
    };
  }

  if (shouldUpdateMaxInstances) {
    update.template.scaling = {
      ...(service.template?.scaling || {}),
      maxInstanceCount: orchestratorConfig.maxInstanceCount,
    };
    paths.push('template.scaling.max_instance_count');
  }

  if (shouldUpdateRuntimeServiceAccount) {
    update.template.serviceAccount =
      orchestratorConfig.runtimeServiceAccountEmail;
    paths.push('template.service_account');
  }

  if (
    shouldUpdateImage ||
    shouldUpdateCpuAllocation ||
    shouldUpdateSecurityEnvironment
  ) {
    const containers =
      service.template?.containers && service.template.containers.length > 0
        ? service.template.containers.map((container: any, index: number) =>
            index === 0
              ? {
                  ...container,
                  env: desiredEnvironment,
                  image: orchestratorImageUri,
                  name: container.name || 'orchestrator',
                  resources: {
                    ...(container.resources || {}),
                    cpuIdle: orchestratorConfig.cpuIdle,
                    startupCpuBoost: true,
                  },
                }
              : container,
          )
        : [
            {
              env: desiredEnvironment,
              image: orchestratorImageUri,
              name: 'orchestrator',
              resources: {
                cpuIdle: orchestratorConfig.cpuIdle,
                startupCpuBoost: true,
              },
            },
          ];

    update.template.containers = containers;
    paths.push('template.containers');
  }

  let updatedService: any;
  try {
    console.log(
      `[CloudRun] Updating ${formattedServiceName} configuration${shouldUpdateImage ? ` to image ${orchestratorImageUri}` : ''}${shouldUpdateCpuAllocation ? ` with cpuIdle=${orchestratorConfig.cpuIdle}` : ''}${shouldUpdateSecurityEnvironment ? ' with private caller identity enforcement' : ''}.`,
    );
    const [updateOperation] = await servicesClient.updateService({
      service: update,
      updateMask: { paths },
    });
    [updatedService] = await updateOperation.promise();
  } catch (err: any) {
    console.error(
      `[CloudRun] Warning: Failed to update orchestrator service configuration:`,
      err.message,
    );
    if (
      shouldUpdateSecurityEnvironment ||
      shouldEnableInvokerIamCheck ||
      shouldUpdateRuntimeServiceAccount
    ) {
      throw new Error(
        `Cloud Run orchestrator security configuration could not be applied: ${err.message}`,
      );
    }
    if (shouldUpdateMinInstances || shouldUpdateCpuAllocation) {
      throw new Error(
        `Cloud Run orchestrator detached-execution configuration could not be applied: ${err.message}`,
      );
    }
    return serviceUri;
  }

  assertDetachedOrchestratorServiceConfiguration(updatedService);
  return normalizeOrchestratorServiceUri(updatedService.uri || serviceUri);
}

export async function ensureOrchestratorService(
  projectId: string,
  accessToken: string,
  settings: GcpCloudRunSettings,
): Promise<string> {
  const oauth2Client = new OAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  const cloudRunLocation = requireSetting(
    settings.cloudRunLocation,
    'Cloud Run region',
  );
  const orchestratorConfig = getOrchestratorCloudRunConfig(settings);
  const orchestratorImageUri = getOrchestratorImageUri(
    projectId,
    requireSetting(
      settings.orchestratorImageUriTemplate,
      'Orchestrator image URI template',
    ),
  );
  const servicesClient = new ServicesClient({
    authClient: oauth2Client as any,
    projectId,
  });
  const formattedServiceName = `projects/${projectId}/locations/${cloudRunLocation}/services/${orchestratorConfig.serviceName}`;
  let service: any;
  try {
    [service] = await servicesClient.getService({
      name: formattedServiceName,
    });
  } catch (err: any) {
    if (err.code !== 5 && !String(err.message).includes('NOT_FOUND')) {
      console.error(
        `[CloudRun] Error checking service ${formattedServiceName}:`,
        err.message,
      );
      throw err;
    }
  }

  if (!service) {
    console.log(
      `[CloudRun] Service ${formattedServiceName} not found. Creating it dynamically...`,
    );
    const parent = `projects/${projectId}/locations/${cloudRunLocation}`;
    const createOperation = await servicesClient.createService({
      parent,
      serviceId: orchestratorConfig.serviceName,
      service: {
        invokerIamDisabled: false,
        scaling: {
          minInstanceCount: orchestratorConfig.minInstanceCount,
        },
        template: {
          serviceAccount: orchestratorConfig.runtimeServiceAccountEmail,
          scaling: {
            maxInstanceCount: orchestratorConfig.maxInstanceCount,
          },
          containers: [
            {
              env: withOrchestratorEditorApiEnvironment(
                undefined,
                orchestratorConfig.editorApiUrl,
              ),
              image: orchestratorImageUri,
              name: 'orchestrator',
              resources: {
                cpuIdle: orchestratorConfig.cpuIdle,
                startupCpuBoost: true,
              },
            },
          ],
        },
      },
    });
    console.log(`[CloudRun] Waiting for service creation to complete...`);
    [service] = await createOperation[0].promise();
  }

  // A normal existing service is made private before rolling its security
  // revision. If IAM checks had been disabled, the revision enables them before
  // the final policy reconciliation.
  if (service.invokerIamDisabled !== true) {
    await ensurePrivateOrchestratorIamPolicy(
      servicesClient,
      formattedServiceName,
      orchestratorConfig.callerServiceAccountEmail,
    );
  }
  const serviceUri = await ensureServiceConfiguration(
    servicesClient,
    service,
    formattedServiceName,
    orchestratorConfig,
    orchestratorImageUri,
  );
  await ensurePrivateOrchestratorIamPolicy(
    servicesClient,
    formattedServiceName,
    orchestratorConfig.callerServiceAccountEmail,
  );
  console.log(
    `[CloudRun] Service ${formattedServiceName} is private and ready at ${serviceUri}.`,
  );

  return serviceUri;
}
