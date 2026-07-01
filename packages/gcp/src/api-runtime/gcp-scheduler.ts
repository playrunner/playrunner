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

function clarifySchedulerError(message: string, projectId?: string): string {
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
    const gcloudProject = projectId || '<project-id>';

    return `${normalizedMessage}. Enable Cloud Scheduler for ${projectLabel} by running "terraform -chdir=infra/gcp apply" from the repo root. This is the preferred setup path because Terraform also manages the scheduler service account. If you need a direct API enable step, run "gcloud services enable cloudscheduler.googleapis.com --project ${gcloudProject}".`;
  }

  return message;
}

async function schedulerRequest<T>({
  accessToken,
  body,
  method,
  path,
  projectId,
}: {
  accessToken: string;
  body?: Record<string, any>;
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
    const message = clarifySchedulerError(await readError(response), projectId);
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
): Promise<CloudSchedulerJob | null> {
  try {
    return await schedulerRequest<CloudSchedulerJob>({
      accessToken,
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

async function getSchedulerContext(request: SchedulerProvisionRequest) {
  const credentials = request.credentials as GcpTokenRefresh &
    Record<string, any>;
  const accessToken = requiredString(
    credentials.accessToken,
    'GCP access token',
    'GCP credentials required. Connect a GCP account in Settings.',
  );
  const projectId = requiredString(
    credentials.selectedProject,
    'GCP project',
    'GCP project required. Select a project in Settings > Google Cloud.',
  );
  const location = requiredString(
    credentials.schedulerLocation || credentials.cloudRunLocation,
    'Cloud Scheduler location',
    'Cloud Scheduler location required. Save a Cloud Run region in Settings > Google Cloud.',
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
    const { accessToken, jobName, projectId } =
      await getSchedulerContext(request);
    const name = request.schedule.gcpJobName || jobName;

    await ignoreMissingJob(() =>
      schedulerRequest({
        accessToken,
        method: 'DELETE',
        path: name,
        projectId,
      }),
    );
  }

  async pause(
    request: SchedulerProvisionRequest,
  ): Promise<SchedulerProvisionResult | void> {
    const { accessToken, jobName, projectId } =
      await getSchedulerContext(request);
    const name = request.schedule.gcpJobName || jobName;

    await ignoreMissingJob(() =>
      schedulerRequest({
        accessToken,
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
    const existing = await tryGetJob(accessToken, jobName, projectId);

    if (!existing) {
      const parent = `projects/${projectId}/locations/${location}`;
      await schedulerRequest({
        accessToken,
        body: jobBody,
        method: 'POST',
        path: `${parent}/jobs?jobId=${encodeURIComponent(
          jobName.split('/').pop() ||
            buildJobId(
              request.schedule.workflowId,
              request.schedule.scheduleNodeId,
            ),
        )}`,
        projectId,
      });

      return { gcpJobName: jobName };
    }

    await schedulerRequest({
      accessToken,
      body: jobBody,
      method: 'PATCH',
      path: `${jobName}?updateMask=${encodeURIComponent(
        'description,schedule,timeZone,httpTarget',
      )}`,
      projectId,
    });

    if (existing.state === 'PAUSED') {
      await schedulerRequest({
        accessToken,
        method: 'POST',
        path: `${jobName}:resume`,
        projectId,
      });
    }

    return { gcpJobName: jobName };
  }
}
