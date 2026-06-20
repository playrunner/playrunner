import { ServicesClient } from '@google-cloud/run';
import { OAuth2Client } from 'google-auth-library';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set for GCP Cloud Run integration.`);
  }
  return value;
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, value),
    template,
  );
}

function getOrchestratorImageUri(projectId: string): string {
  return renderTemplate(requireEnv('GCP_ORCHESTRATOR_IMAGE_URI_TEMPLATE'), { projectId });
}

export async function ensureOrchestratorService(
  projectId: string,
  accessToken: string
): Promise<string> {
  const oauth2Client = new OAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  const cloudRunLocation = requireEnv('GCP_CLOUD_RUN_LOCATION');
  const orchestratorServiceName = requireEnv('GCP_ORCHESTRATOR_SERVICE_NAME');
  const servicesClient = new ServicesClient({ authClient: oauth2Client, projectId });
  const formattedServiceName = `projects/${projectId}/locations/${cloudRunLocation}/services/${orchestratorServiceName}`;

  let serviceUri = '';

  try {
    const [service] = await servicesClient.getService({ name: formattedServiceName });
    serviceUri = service.uri!;
  } catch (err: any) {
    if (err.code === 5 || err.message.includes('NOT_FOUND')) {
      console.log(`[CloudRun] Service ${formattedServiceName} not found. Creating it dynamically...`);
      const orchestratorImageUri = getOrchestratorImageUri(projectId);

      const parent = `projects/${projectId}/locations/${cloudRunLocation}`;

      const createOperation = await servicesClient.createService({
        parent,
        serviceId: orchestratorServiceName,
        service: {
          template: {
            scaling: {
              maxInstanceCount: 10
            },
            containers: [
              {
                image: orchestratorImageUri,
                name: 'orchestrator'
              }
            ]
          }
        }
      });

      console.log(`[CloudRun] Waiting for service creation to complete...`);
      const [service] = await createOperation[0].promise();
      serviceUri = service.uri!;
      console.log(`[CloudRun] Service ${formattedServiceName} created successfully at ${serviceUri}.`);

      try {
        await servicesClient.setIamPolicy({
          resource: formattedServiceName,
          policy: {
            bindings: [
              {
                role: 'roles/run.invoker',
                members: ['allUsers']
              }
            ]
          }
        });
        console.log(`[CloudRun] Set IAM policy to allow unauthenticated invocations for ${orchestratorServiceName}.`);
      } catch (iamErr: any) {
        console.error(`[CloudRun] Warning: Failed to set IAM policy:`, iamErr.message);
      }
    } else {
      console.error(`[CloudRun] Error checking service ${formattedServiceName}:`, err.message);
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
