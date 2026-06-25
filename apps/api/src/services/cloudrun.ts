import { ServicesClient } from '@google-cloud/run';
import { OAuth2Client } from 'google-auth-library';

const DEFAULT_ORCHESTRATOR_SERVICE_NAME = 'playrunner-orchestrator';
const ORCHESTRATOR_MIN_INSTANCE_COUNT = 1;
const ORCHESTRATOR_MAX_INSTANCE_COUNT = 10;

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
  orchestratorImageUri: string,
): Promise<string> {
  const serviceUri = service.uri!;
  const currentMinInstances = Number(service.scaling?.minInstanceCount || 0);
  const currentImage = service.template?.containers?.[0]?.image;
  const shouldUpdateMinInstances =
    currentMinInstances < ORCHESTRATOR_MIN_INSTANCE_COUNT;
  const shouldUpdateImage = currentImage !== orchestratorImageUri;

  if (!shouldUpdateMinInstances && !shouldUpdateImage) {
    return serviceUri;
  }

  const update: Record<string, any> = {
    name: formattedServiceName,
  };
  const paths: string[] = [];

  if (shouldUpdateMinInstances) {
    update.scaling = {
      ...(service.scaling || {}),
      minInstanceCount: ORCHESTRATOR_MIN_INSTANCE_COUNT,
    };
    paths.push('scaling.min_instance_count');
  }

  if (shouldUpdateImage) {
    update.template = {
      ...(service.template || {}),
    };
  }

  if (shouldUpdateImage) {
    const containers =
      service.template?.containers && service.template.containers.length > 0
        ? service.template.containers.map((container: any, index: number) =>
            index === 0
              ? {
                  ...container,
                  image: orchestratorImageUri,
                  name: container.name || 'orchestrator',
                }
              : container,
          )
        : [
            {
              image: orchestratorImageUri,
              name: 'orchestrator',
              resources: {
                startupCpuBoost: true,
              },
            },
          ];

    update.template.containers = containers;
    paths.push('template.containers');
  }

  try {
    console.log(
      `[CloudRun] Updating ${formattedServiceName} configuration${shouldUpdateImage ? ` to image ${orchestratorImageUri}` : ''}.`,
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
  const orchestratorServiceName =
    settings.orchestratorServiceName?.trim() ||
    DEFAULT_ORCHESTRATOR_SERVICE_NAME;
  const orchestratorImageUri = getOrchestratorImageUri(
    projectId,
    requireSetting(
      settings.orchestratorImageUriTemplate,
      'Orchestrator image URI template',
    ),
  );
  const servicesClient = new ServicesClient({
    authClient: oauth2Client,
    projectId,
  });
  const formattedServiceName = `projects/${projectId}/locations/${cloudRunLocation}/services/${orchestratorServiceName}`;

  let serviceUri = '';

  try {
    const [service] = await servicesClient.getService({
      name: formattedServiceName,
    });
    serviceUri = await ensureServiceConfiguration(
      servicesClient,
      service,
      formattedServiceName,
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
        serviceId: orchestratorServiceName,
        service: {
          scaling: {
            minInstanceCount: ORCHESTRATOR_MIN_INSTANCE_COUNT,
          },
          template: {
            scaling: {
              maxInstanceCount: ORCHESTRATOR_MAX_INSTANCE_COUNT,
            },
            containers: [
              {
                image: orchestratorImageUri,
                name: 'orchestrator',
                resources: {
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
          `[CloudRun] Set IAM policy to allow unauthenticated invocations for ${orchestratorServiceName}.`,
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
