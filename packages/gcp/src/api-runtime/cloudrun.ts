import { ServicesClient } from '@google-cloud/run';
import { OAuth2Client } from 'google-auth-library';

const ORCHESTRATOR_SERVICE_NAME_ENV = 'GCP_ORCHESTRATOR_SERVICE_NAME';
const ORCHESTRATOR_MIN_INSTANCE_COUNT_ENV =
  'GCP_ORCHESTRATOR_MIN_INSTANCE_COUNT';
const ORCHESTRATOR_MAX_INSTANCE_COUNT_ENV =
  'GCP_ORCHESTRATOR_MAX_INSTANCE_COUNT';
const ORCHESTRATOR_CPU_IDLE_ENV = 'GCP_ORCHESTRATOR_CPU_IDLE';

type OrchestratorCloudRunConfig = {
  cpuIdle: boolean;
  maxInstanceCount: number;
  minInstanceCount: number;
  serviceName: string;
};

export interface GcpCloudRunSettings {
  cloudRunLocation?: string;
  orchestratorImageUriTemplate?: string;
  orchestratorServiceName?: string;
}

function requireSetting(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${name} must be configured in GCP settings.`);
  }
  return normalized;
}

function requireEnvSetting(name: string): string {
  const normalized = process.env[name]?.trim();
  if (!normalized) {
    throw new Error(`${name} must be set in apps/api/.env for GCP runs.`);
  }
  return normalized;
}

function requireEnvPositiveInteger(name: string): number {
  const rawValue = requireEnvSetting(name);
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `${name} must be set to a positive integer in apps/api/.env.`,
    );
  }
  return value;
}

function requireEnvBoolean(name: string): boolean {
  const rawValue = requireEnvSetting(name).toLowerCase();
  if (rawValue === 'true') {
    return true;
  }
  if (rawValue === 'false') {
    return false;
  }
  throw new Error(`${name} must be set to true or false in apps/api/.env.`);
}

function getOrchestratorCloudRunConfig(
  settings: GcpCloudRunSettings,
): OrchestratorCloudRunConfig {
  const defaultServiceName = requireEnvSetting(ORCHESTRATOR_SERVICE_NAME_ENV);
  const serviceName =
    settings.orchestratorServiceName?.trim() || defaultServiceName;
  const minInstanceCount = requireEnvPositiveInteger(
    ORCHESTRATOR_MIN_INSTANCE_COUNT_ENV,
  );
  const maxInstanceCount = requireEnvPositiveInteger(
    ORCHESTRATOR_MAX_INSTANCE_COUNT_ENV,
  );

  if (maxInstanceCount < minInstanceCount) {
    throw new Error(
      `${ORCHESTRATOR_MAX_INSTANCE_COUNT_ENV} must be greater than or equal to ${ORCHESTRATOR_MIN_INSTANCE_COUNT_ENV}.`,
    );
  }

  return {
    cpuIdle: requireEnvBoolean(ORCHESTRATOR_CPU_IDLE_ENV),
    maxInstanceCount,
    minInstanceCount,
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

async function ensureServiceConfiguration(
  servicesClient: ServicesClient,
  service: any,
  formattedServiceName: string,
  orchestratorConfig: OrchestratorCloudRunConfig,
  orchestratorImageUri: string,
): Promise<string> {
  const serviceUri = service.uri!;
  const currentMinInstances = Number(service.scaling?.minInstanceCount || 0);
  const currentMaxInstances = Number(
    service.template?.scaling?.maxInstanceCount || 0,
  );
  const currentContainer = service.template?.containers?.[0];
  const currentImage = currentContainer?.image;
  const currentCpuIdle = currentContainer?.resources?.cpuIdle;
  const shouldUpdateMinInstances =
    currentMinInstances !== orchestratorConfig.minInstanceCount;
  const shouldUpdateMaxInstances =
    currentMaxInstances !== orchestratorConfig.maxInstanceCount;
  const shouldUpdateImage = currentImage !== orchestratorImageUri;
  const shouldUpdateCpuAllocation =
    currentCpuIdle !== orchestratorConfig.cpuIdle;

  if (
    !shouldUpdateMinInstances &&
    !shouldUpdateMaxInstances &&
    !shouldUpdateImage &&
    !shouldUpdateCpuAllocation
  ) {
    return serviceUri;
  }

  const update: Record<string, any> = {
    name: formattedServiceName,
  };
  const paths: string[] = [];

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
    shouldUpdateCpuAllocation
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

  if (shouldUpdateImage || shouldUpdateCpuAllocation) {
    const containers =
      service.template?.containers && service.template.containers.length > 0
        ? service.template.containers.map((container: any, index: number) =>
            index === 0
              ? {
                  ...container,
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

  try {
    console.log(
      `[CloudRun] Updating ${formattedServiceName} configuration${shouldUpdateImage ? ` to image ${orchestratorImageUri}` : ''}${shouldUpdateCpuAllocation ? ' with always-allocated CPU' : ''}.`,
    );
    const [updateOperation] = await servicesClient.updateService({
      service: update,
      updateMask: { paths },
    });
    const [updatedService] = await updateOperation.promise();
    return updatedService.uri || serviceUri;
  } catch (err: any) {
    console.error(
      `[CloudRun] Warning: Failed to update orchestrator service configuration:`,
      err.message,
    );
    return serviceUri;
  }
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

  let serviceUri = '';

  try {
    const [service] = await servicesClient.getService({
      name: formattedServiceName,
    });
    serviceUri = await ensureServiceConfiguration(
      servicesClient,
      service,
      formattedServiceName,
      orchestratorConfig,
      orchestratorImageUri,
    );
  } catch (err: any) {
    if (err.code === 5 || err.message.includes('NOT_FOUND')) {
      console.log(
        `[CloudRun] Service ${formattedServiceName} not found. Creating it dynamically...`,
      );
      const parent = `projects/${projectId}/locations/${cloudRunLocation}`;

      const createOperation = await servicesClient.createService({
        parent,
        serviceId: orchestratorConfig.serviceName,
        service: {
          scaling: {
            minInstanceCount: orchestratorConfig.minInstanceCount,
          },
          template: {
            scaling: {
              maxInstanceCount: orchestratorConfig.maxInstanceCount,
            },
            containers: [
              {
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
      const [service] = await createOperation[0].promise();
      serviceUri = service.uri!;
      console.log(
        `[CloudRun] Service ${formattedServiceName} created successfully at ${serviceUri}.`,
      );

      try {
        await servicesClient.setIamPolicy({
          resource: formattedServiceName,
          policy: {
            bindings: [
              {
                role: 'roles/run.invoker',
                members: ['allUsers'],
              },
            ],
          },
        });
        console.log(
          `[CloudRun] Set IAM policy to allow unauthenticated invocations for ${orchestratorConfig.serviceName}.`,
        );
      } catch (iamErr: any) {
        console.error(
          `[CloudRun] Warning: Failed to set IAM policy:`,
          iamErr.message,
        );
      }
    } else {
      console.error(
        `[CloudRun] Error checking service ${formattedServiceName}:`,
        err.message,
      );
      throw err;
    }
  }

  try {
    await fetch(`${serviceUri}/health`);
  } catch {
    // ignore
  }

  return serviceUri;
}
