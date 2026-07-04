import crypto from 'crypto';
import { refreshGcpAccessTokenIfNeeded, type GcpTokenRefresh } from './gcs';
import type {
  SchedulerProvisionRequest,
  SchedulerProvisionResult,
  SchedulerProvisioner,
} from './contracts';

const CLOUD_SCHEDULER_API_BASE_URL = 'https://cloudscheduler.googleapis.com/v1';

type CloudSchedulerJob = {
  name?: string;
  state?: string;
};

function defaultSchedulerServiceAccountEmail(projectId: string): string {
  return `playrunner-scheduler@${projectId}.iam.gserviceaccount.com`;
}

function requiredString(
  value: unknown,
  label: string,
  message?: string,
): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Error(message || `${label} is required for GCP schedules.`);
  }
  return normalized;
}

function sanitizeJobSegment(value: string, fallback: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return sanitized || fallback;
}

function buildJobId(workflowId: string, scheduleNodeId: string): string {
  const workflowSegment = sanitizeJobSegment(workflowId, 'workflow');
  const nodeSegment = sanitizeJobSegment(scheduleNodeId, 'schedule');
  const hash = crypto
    .createHash('sha1')
    .update(`${workflowId}:${scheduleNodeId}`)
    .digest('hex')
    .slice(0, 10);

  return `playrunner-${workflowSegment}-${nodeSegment}-${hash}`.slice(0, 500);
}

function buildJobName({
  location,
  projectId,
  scheduleNodeId,
  workflowId,
}: {
  location: string;
  projectId: string;
  scheduleNodeId: string;
  workflowId: string;
}): string {
  return `projects/${projectId}/locations/${location}/jobs/${buildJobId(
    workflowId,
    scheduleNodeId,
  )}`;
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  if (!text.trim()) {
    return `${response.status} ${response.statusText}`;
  }

  try {
    const payload = JSON.parse(text);
    const message =
      typeof payload?.error?.message === 'string'
        ? payload.error.message
        : text;
    return `${response.status} ${response.statusText}: ${message}`;
  } catch {
    return `${response.status} ${response.statusText}: ${text}`;
  }
}

function buildTerraformApplyCommand(projectId?: string, location?: string) {
  const args = [
    projectId ? `-var="project_id=${projectId}"` : '',
    location ? `-var="region=${location}"` : '',
  ].filter(Boolean);

  return `terraform -chdir=infra/gcp apply${args.length ? ` ${args.join(' ')}` : ''}`;
}

function clarifySchedulerError(
  message: string,
  projectId?: string,
  location?: string,
): string {
  if (
    message.includes('cloudscheduler.googleapis.com') &&
    (message.includes('has not been used') ||
      message.includes('disabled') ||
      message.includes('SERVICE_DISABLED'))
  ) {
    const normalizedMessage = message.trim().replace(/\.+$/g, '');
    const projectLabel = projectId
      ? `project ${projectId}`
      : 'the selected project';
    const terraformCommand = buildTerraformApplyCommand(projectId, location);

    return `${normalizedMessage}. Enable Cloud Scheduler for ${projectLabel} by running "${terraformCommand}" from the repo root, or save project_id and region in infra/gcp/terraform.tfvars and run "terraform -chdir=infra/gcp apply". Terraform also creates the scheduler service account used by schedule triggers.`;
  }

  return message;
}

async function schedulerRequest<T>({
  accessToken,
  body,
  method,
  path,
  location,
  projectId,
}: {
  accessToken: string;
  body?: Record<string, any>;
  location?: string;
  method: string;
  path: string;
  projectId?: string;
}): Promise<T> {
  const response = await fetch(`${CLOUD_SCHEDULER_API_BASE_URL}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const message = clarifySchedulerError(
      await readError(response),
      projectId,
      location,
    );
    const error = new Error(`Cloud Scheduler request failed: ${message}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function tryGetJob(
  accessToken: string,
  jobName: string,
  projectId: string,
  location: string,
): Promise<CloudSchedulerJob | null> {
  try {
    return await schedulerRequest<CloudSchedulerJob>({
      accessToken,
      location,
      method: 'GET',
      path: jobName,
      projectId,
    });
  } catch (error) {
    if ((error as Error & { status?: number }).status === 404) {
      return null;
    }
    throw error;
  }
}

async function ignoreMissingJob(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if ((error as Error & { status?: number }).status === 404) {
      return;
    }
    throw error;
  }
}

function buildJobBody({
  jobName,
  request,
  serviceAccountEmail,
}: {
  jobName: string;
  request: SchedulerProvisionRequest;
  serviceAccountEmail: string;
}) {
  assertHttpsSchedulerTarget(request.triggerUrl);

  return {
    name: jobName,
    description: `Playrunner schedule ${request.schedule.scheduleNodeId} for workflow ${request.schedule.workflowId}`,
    schedule: request.schedule.cron,
    timeZone: request.schedule.timezone,
    httpTarget: {
      uri: request.triggerUrl,
      httpMethod: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Playrunner-Scheduler-JobName': jobName,
      },
      body: Buffer.from(JSON.stringify(request.triggerPayload)).toString(
        'base64',
      ),
      oidcToken: {
        audience: request.triggerUrl,
        serviceAccountEmail,
      },
    },
  };
}

function assertHttpsSchedulerTarget(triggerUrl: string) {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(triggerUrl);
  } catch {
    throw new Error(
      `Cloud Scheduler target URL is invalid: "${triggerUrl}". Set PLAYRUNNER_PUBLIC_API_URL in apps/api/.env to the HTTPS base URL that Google Cloud Scheduler can reach, then restart the API and save the workflow again.`,
    );
  }

  if (parsedUrl.protocol === 'https:') {
    return;
  }

  throw new Error(
    `Cloud Scheduler target URL must start with https:// because Playrunner uses OIDC authentication for scheduled runs. Current target is "${triggerUrl}". Set PLAYRUNNER_PUBLIC_API_URL in apps/api/.env to an HTTPS public API base URL, such as the Terraform api_service_uri output or a Cloudflare Tunnel URL, then restart the API and save the workflow again. For local API testing, run "cloudflared tunnel --url http://127.0.0.1:<api-port>" and use the printed https://... URL.`,
  );
}

async function getSchedulerContext(request: SchedulerProvisionRequest) {
  const credentials = request.credentials as GcpTokenRefresh &
    Record<string, any>;
  const accessToken = requiredString(
    credentials.accessToken,
    'GCP access token',
    'GCP credentials required. Connect GCP from the GCP Runner menu or Integrations.',
  );
  const projectId = requiredString(
    credentials.selectedProject,
    'GCP project',
    'GCP project required. Select a project in the Connect to GCP dialog.',
  );
  const location = requiredString(
    credentials.schedulerLocation || credentials.cloudRunLocation,
    'Cloud Scheduler location',
    'Cloud Scheduler location required. Save a Cloud Run region in the Connect to GCP dialog.',
  );
  const configuredServiceAccountEmail =
    typeof credentials.schedulerServiceAccountEmail === 'string'
      ? credentials.schedulerServiceAccountEmail.trim()
      : '';
  const serviceAccountEmail =
    configuredServiceAccountEmail ||
    defaultSchedulerServiceAccountEmail(projectId);

  const refreshedAccessToken =
    (await refreshGcpAccessTokenIfNeeded(credentials)) || accessToken;

  return {
    accessToken: refreshedAccessToken,
    jobName: buildJobName({
      location,
      projectId,
      scheduleNodeId: request.schedule.scheduleNodeId,
      workflowId: request.schedule.workflowId,
    }),
    location,
    projectId,
    serviceAccountEmail,
  };
}

export class GcpCloudSchedulerProvisioner implements SchedulerProvisioner {
  supports(provider: string): boolean {
    return provider === 'GCP';
  }

  async delete(request: SchedulerProvisionRequest): Promise<void> {
    const { accessToken, jobName, location, projectId } =
      await getSchedulerContext(request);
    const name = request.schedule.gcpJobName || jobName;

    await ignoreMissingJob(() =>
      schedulerRequest({
        accessToken,
        location,
        method: 'DELETE',
        path: name,
        projectId,
      }),
    );
  }

  async pause(
    request: SchedulerProvisionRequest,
  ): Promise<SchedulerProvisionResult | void> {
    const { accessToken, jobName, location, projectId } =
      await getSchedulerContext(request);
    const name = request.schedule.gcpJobName || jobName;

    await ignoreMissingJob(() =>
      schedulerRequest({
        accessToken,
        location,
        method: 'POST',
        path: `${name}:pause`,
        projectId,
      }),
    );

    return { gcpJobName: name };
  }

  async upsert(
    request: SchedulerProvisionRequest,
  ): Promise<SchedulerProvisionResult> {
    const { accessToken, jobName, projectId, location, serviceAccountEmail } =
      await getSchedulerContext(request);
    const jobBody = buildJobBody({
      jobName,
      request,
      serviceAccountEmail,
    });
    const existing = await tryGetJob(accessToken, jobName, projectId, location);

    if (!existing) {
      const parent = `projects/${projectId}/locations/${location}`;
      await schedulerRequest({
        accessToken,
        body: jobBody,
        location,
        method: 'POST',
        path: `${parent}/jobs`,
        projectId,
      });

      return { gcpJobName: jobName };
    }

    await schedulerRequest({
      accessToken,
      body: jobBody,
      location,
      method: 'PATCH',
      path: `${jobName}?updateMask=${encodeURIComponent(
        'description,schedule,timeZone,httpTarget',
      )}`,
      projectId,
    });

    if (existing.state === 'PAUSED') {
      await schedulerRequest({
        accessToken,
        location,
        method: 'POST',
        path: `${jobName}:resume`,
        projectId,
      });
    }

    return { gcpJobName: jobName };
  }
}
