import type {
  PlaywrightExecutionBackend,
  PlaywrightExecutionRequest,
  PreparedPlaywrightRunner,
} from './contracts';
import {
  createPubSubRunnerControl,
  resolveWorkflowEventsTopicName,
} from './pubsub-runner-control';

type CloudRunOperation = {
  done?: boolean;
  error?: { message?: string };
  name: string;
  response?: { name?: string };
};

type CloudRunExecution = {
  conditions?: Array<{ state?: string; type?: string }>;
  name?: string;
};

type CloudRunJob = {
  name?: string;
  template?: {
    template?: {
      containers?: Array<{
        image?: string;
        name?: string;
        resources?: {
          limits?: Record<string, string>;
          startupCpuBoost?: boolean;
        };
      }>;
    };
  };
};

type GcpPlaywrightRunSettings = {
  accessToken: string;
  cloudRunLocation: string;
  cpu: number;
  imageUri: string;
  jobName: string;
  memory: number;
  playwrightVersion: string;
  projectId: string;
  topicName: string;
  workers: number;
};

const POLL_INTERVAL_MS = 3000;
const MAX_TRANSIENT_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 1000;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const CLOUD_RUN_API_BASE_URL = 'https://run.googleapis.com/v2';
const DEFAULT_PLAYWRIGHT_JOB_NAME_TEMPLATE = 'playrunner-{runtime}';
let cloudRunJobLaunchQueue = Promise.resolve();

function requireSetting(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${name} must be configured in GCP settings.`);
  }
  return normalized;
}

function requireRequestValue(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required for GCP Playwright execution.`);
  }
  return value;
}

function requirePositiveNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(
      `${name} must be provided as a positive number for GCP Playwright execution.`,
    );
  }
  return value;
}

function requirePositiveInteger(value: unknown, name: string): number {
  const numberValue =
    typeof value === 'string' && value.trim()
      ? Number(value)
      : typeof value === 'number'
        ? value
        : NaN;
  if (
    !Number.isInteger(numberValue) ||
    !Number.isFinite(numberValue) ||
    numberValue <= 0
  ) {
    throw new Error(
      `${name} must be provided as a positive integer for GCP Playwright execution.`,
    );
  }
  return numberValue;
}

function renderTemplate(
  template: string,
  values: Record<string, string | number>,
): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

function cloudRunUrl(resourcePath: string): string {
  return `${CLOUD_RUN_API_BASE_URL}/${resourcePath}`;
}

function getWorkflowEventsTopicName(reqBody: any): string {
  return resolveWorkflowEventsTopicName(reqBody.eventTransport?.topicName);
}

async function withCloudRunJobLaunchLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const previousLaunch = cloudRunJobLaunchQueue;
  let releaseLaunch!: () => void;
  cloudRunJobLaunchQueue = new Promise<void>((resolve) => {
    releaseLaunch = resolve;
  });

  await previousLaunch.catch(() => {});

  try {
    return await operation();
  } finally {
    releaseLaunch();
  }
}

function resolvePlaywrightCloudImage(
  projectId: string,
  runtime: string,
  version: string,
  template: string,
): string {
  return renderTemplate(template, {
    projectId,
    runtime,
    version,
  });
}

function resolveJobName(
  template: string,
  runtime: string,
  version: string,
  cpu: number,
  memory: number,
): string {
  return renderTemplate(template, {
    cpu,
    memory,
    runtime,
    version,
  })
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .toLowerCase();
}

async function cloudRunRequest<T>(
  resourcePath: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetch(cloudRunUrl(resourcePath), {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...(init.headers || {}),
        },
      });
    } catch (error) {
      lastError = error;
      if (attempt === MAX_TRANSIENT_RETRIES) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_BASE_DELAY_MS * 2 ** attempt),
      );
      continue;
    }

    if (!response.ok) {
      const details = await response.text();
      if (
        RETRYABLE_STATUS_CODES.has(response.status) &&
        attempt < MAX_TRANSIENT_RETRIES
      ) {
        lastError = new Error(
          `Cloud Run API returned ${response.status}: ${details}`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_BASE_DELAY_MS * 2 ** attempt),
        );
        continue;
      }
      throw new Error(`Cloud Run API returned ${response.status}: ${details}`);
    }

    return response.json() as Promise<T>;
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Cloud Run API request failed after retries.');
}

async function getPlaywrightJob(
  jobPath: string,
  accessToken: string,
): Promise<CloudRunJob | null> {
  try {
    return await cloudRunRequest<CloudRunJob>(jobPath, accessToken);
  } catch (error: any) {
    if (error.message?.includes('Cloud Run API returned 404')) {
      return null;
    }
    throw error;
  }
}

async function waitForOperation(
  operationName: string,
  accessToken: string,
): Promise<CloudRunOperation> {
  while (true) {
    const operation = await cloudRunRequest<CloudRunOperation>(
      operationName,
      accessToken,
    );
    if (operation.done) {
      if (operation.error?.message) {
        throw new Error(operation.error.message);
      }
      return operation;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

async function waitForExecution(
  executionName: string,
  accessToken: string,
): Promise<void> {
  while (true) {
    const execution = await cloudRunRequest<CloudRunExecution>(
      executionName,
      accessToken,
    );
    const completed = execution.conditions?.find(
      (condition) => condition.type === 'Completed',
    );
    if (completed?.state === 'CONDITION_SUCCEEDED') {
      return;
    }
    if (completed?.state === 'CONDITION_FAILED') {
      throw new Error(
        `Playwright Cloud Run Execution ${execution.name || executionName} failed.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

async function ensurePlaywrightJob(args: {
  accessToken: string;
  cpu: number;
  imageUri: string;
  jobName: string;
  location: string;
  memory: number;
  projectId: string;
}): Promise<string> {
  const parentPath = `projects/${args.projectId}/locations/${args.location}`;
  const jobPath = `${parentPath}/jobs/${args.jobName}`;

  const existingJob = await getPlaywrightJob(jobPath, args.accessToken);
  if (existingJob) {
    const container = existingJob.template?.template?.containers?.find(
      (candidate) => candidate.name === 'playwright',
    );
    const limits = container?.resources?.limits || {};
    const hasRequestedTemplate =
      container?.image === args.imageUri &&
      limits.cpu === `${args.cpu}` &&
      limits.memory === `${args.memory}Gi`;

    if (hasRequestedTemplate) {
      return jobPath;
    }

    const operation = await cloudRunRequest<CloudRunOperation>(
      `${jobPath}?updateMask=template.template.containers,template.template.maxRetries`,
      args.accessToken,
      {
        method: 'PATCH',
        body: JSON.stringify({
          name: jobPath,
          template: {
            template: {
              containers: [
                {
                  image: args.imageUri,
                  name: 'playwright',
                  resources: {
                    limits: {
                      cpu: `${args.cpu}`,
                      memory: `${args.memory}Gi`,
                    },
                    startupCpuBoost: true,
                  },
                },
              ],
              maxRetries: 0,
            },
          },
        }),
      },
    );
    await waitForOperation(operation.name, args.accessToken);
    return jobPath;
  }

  const operation = await cloudRunRequest<CloudRunOperation>(
    `${parentPath}/jobs?jobId=${args.jobName}`,
    args.accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        template: {
          template: {
            containers: [
              {
                image: args.imageUri,
                name: 'playwright',
                resources: {
                  limits: {
                    cpu: `${args.cpu}`,
                    memory: `${args.memory}Gi`,
                  },
                  startupCpuBoost: true,
                },
              },
            ],
            maxRetries: 0,
          },
        },
      }),
    },
  );

  await waitForOperation(operation.name, args.accessToken);
  return jobPath;
}

async function startPlaywrightJob(args: {
  accessToken: string;
  cpu: number;
  envKeys: string[];
  globalEnvVars: Record<string, string>;
  imageUri: string;
  jobName: string;
  location: string;
  memory: number;
  payloadData: any;
  projectId: string;
  workers: number;
}): Promise<string> {
  const jobPath = await ensurePlaywrightJob(args);
  const env = [
    { name: 'PAYLOAD', value: JSON.stringify(args.payloadData) },
    { name: 'GCP_PROJECT', value: args.projectId },
    { name: 'PLAYWRIGHT_WORKERS', value: String(args.workers) },
    ...args.envKeys.map((key) => ({
      name: key,
      value: args.globalEnvVars[key] || '',
    })),
  ];

  const operation = await cloudRunRequest<CloudRunOperation>(
    `${jobPath}:run`,
    args.accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        overrides: {
          containerOverrides: [{ env, name: 'playwright' }],
        },
      }),
    },
  );
  const completedOperation = await waitForOperation(
    operation.name,
    args.accessToken,
  );
  const executionName = requireRequestValue(
    completedOperation.response?.name,
    'Cloud Run execution name',
  );
  return executionName;
}

function resolveGcpPlaywrightRunSettings(
  request: PlaywrightExecutionRequest,
): GcpPlaywrightRunSettings {
  const { config, reqBody, runtime } = request;
  const projectId = requireRequestValue(reqBody.gcpProject, 'gcpProject');
  const gcpSettings = reqBody.settings?.gcp ?? {};
  const accessToken = requireRequestValue(
    gcpSettings.accessToken,
    'GCP access token',
  );
  const cloudRunLocation = requireSetting(
    gcpSettings.cloudRunLocation,
    'Cloud Run region',
  );
  const playwrightVersion = requireRequestValue(
    config.playwrightVersion,
    'playwrightVersion',
  );
  const cpu = requirePositiveNumber(config.cpu, 'cpu');
  const memory = requirePositiveNumber(config.memory, 'memory');
  const workers = requirePositiveInteger(config.workers || 1, 'workers');
  const imageUri = resolvePlaywrightCloudImage(
    projectId,
    runtime,
    playwrightVersion,
    requireSetting(
      gcpSettings.playwrightImageUriTemplate,
      'Playwright image URI template',
    ),
  );
  const jobName = resolveJobName(
    gcpSettings.playwrightJobNameTemplate ||
      DEFAULT_PLAYWRIGHT_JOB_NAME_TEMPLATE,
    runtime,
    playwrightVersion,
    cpu,
    memory,
  );

  return {
    accessToken,
    cloudRunLocation,
    cpu,
    imageUri,
    jobName,
    memory,
    playwrightVersion,
    projectId,
    topicName: getWorkflowEventsTopicName(reqBody),
    workers,
  };
}

export class GcpPlaywrightExecutionBackend implements PlaywrightExecutionBackend {
  supports(cloudProvider: string): boolean {
    return cloudProvider === 'GCP';
  }

  async execute(request: PlaywrightExecutionRequest): Promise<void> {
    const runner = await this.prepare(request);
    await runner.waitUntilReady();
    await runner.start();
    await runner.waitForCompletion();
  }

  async prepare(
    request: PlaywrightExecutionRequest,
  ): Promise<PreparedPlaywrightRunner> {
    const { envKeys, globalEnvVars, nodeId, payloadData, publishLog, runtime } =
      request;
    const settings = resolveGcpPlaywrightRunSettings(request);
    const executionId = requireRequestValue(
      request.reqBody.testId || payloadData?.data?.testId,
      'testId',
    );
    const runnerControl = await createPubSubRunnerControl({
      accessToken: settings.accessToken,
      executionId,
      nodeId,
      projectId: settings.projectId,
      topicName: settings.topicName,
    });

    const preparedPayloadData = {
      ...payloadData,
      data: {
        ...(payloadData?.data || {}),
        runnerControl: runnerControl.payload,
      },
    };

    await publishLog(
      `Preparing Playwright Runner in Cloud Run Job using ${runtime} image: ${settings.imageUri}`,
      'info',
    );

    const executionName = await withCloudRunJobLaunchLock(() =>
      startPlaywrightJob({
        accessToken: settings.accessToken,
        cpu: settings.cpu,
        envKeys,
        globalEnvVars,
        imageUri: settings.imageUri,
        jobName: settings.jobName,
        location: settings.cloudRunLocation,
        memory: settings.memory,
        payloadData: preparedPayloadData,
        projectId: settings.projectId,
        workers: settings.workers,
      }),
    );

    let ready = false;
    let started = false;
    let completed = false;

    return {
      cleanup: async () => {
        if (!started && !completed) {
          await runnerControl.publishCancel().catch((error) => {
            console.warn(
              `[GCP] Failed to cancel prepared Playwright runner ${nodeId}: ${error.message}`,
            );
          });
          return;
        }
        await runnerControl.cleanup();
      },
      start: async () => {
        started = true;
        await runnerControl.publishStart();
      },
      waitForCompletion: async () => {
        await waitForExecution(executionName, settings.accessToken);
        completed = true;
        await publishLog(
          `Playwright Cloud Run Job (${executionName}) finished successfully.`,
          'info',
        );
      },
      waitUntilReady: async () => {
        if (ready) {
          return;
        }
        await runnerControl.waitUntilReady();
        ready = true;
      },
    };
  }
}
