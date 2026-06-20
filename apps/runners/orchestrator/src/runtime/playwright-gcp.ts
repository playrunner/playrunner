import type { PlaywrightExecutionBackend, PlaywrightExecutionRequest } from './contracts';

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

const POLL_INTERVAL_MS = 3000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set for GCP Playwright execution.`);
  }
  return value;
}

function requireRequestValue(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required for GCP Playwright execution.`);
  }
  return value;
}

function requirePositiveNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be provided as a positive number for GCP Playwright execution.`);
  }
  return value;
}

function renderTemplate(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

function cloudRunUrl(resourcePath: string): string {
  return `${requireEnv('GCP_CLOUD_RUN_API_BASE_URL').replace(/\/$/, '')}/${resourcePath}`;
}

function resolvePlaywrightCloudImage(projectId: string, runtime: string, version: string): string {
  return renderTemplate(requireEnv('GCP_PLAYWRIGHT_IMAGE_URI_TEMPLATE'), { projectId, runtime, version });
}

function resolveJobName(runtime: string, version: string, cpu: number, memory: number): string {
  return renderTemplate(requireEnv('GCP_PLAYWRIGHT_JOB_NAME_TEMPLATE'), { cpu, memory, runtime, version })
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .toLowerCase();
}

async function cloudRunRequest<T>(resourcePath: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(cloudRunUrl(resourcePath), {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Cloud Run API returned ${response.status}: ${details}`);
  }

  return response.json() as Promise<T>;
}

async function jobExists(jobPath: string, accessToken: string): Promise<boolean> {
  try {
    await cloudRunRequest(jobPath, accessToken);
    return true;
  } catch (error: any) {
    if (error.message?.includes('Cloud Run API returned 404')) {
      return false;
    }
    throw error;
  }
}

async function waitForOperation(operationName: string, accessToken: string): Promise<CloudRunOperation> {
  while (true) {
    const operation = await cloudRunRequest<CloudRunOperation>(operationName, accessToken);
    if (operation.done) {
      if (operation.error?.message) {
        throw new Error(operation.error.message);
      }
      return operation;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

async function waitForExecution(executionName: string, accessToken: string): Promise<void> {
  while (true) {
    const execution = await cloudRunRequest<CloudRunExecution>(executionName, accessToken);
    const completed = execution.conditions?.find((condition) => condition.type === 'Completed');
    if (completed?.state === 'CONDITION_SUCCEEDED') {
      return;
    }
    if (completed?.state === 'CONDITION_FAILED') {
      throw new Error(`Playwright Cloud Run Execution ${execution.name || executionName} failed.`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

async function ensurePlaywrightJob(args: {
  accessToken: string;
  cpu: number;
  imageUri: string;
  jobName: string;
  memory: number;
  projectId: string;
}): Promise<string> {
  const location = requireEnv('GCP_CLOUD_RUN_LOCATION');
  const parentPath = `projects/${args.projectId}/locations/${location}`;
  const jobPath = `${parentPath}/jobs/${args.jobName}`;

  if (await jobExists(jobPath, args.accessToken)) {
    return jobPath;
  }

  const operation = await cloudRunRequest<CloudRunOperation>(`${parentPath}/jobs?jobId=${args.jobName}`, args.accessToken, {
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
              },
            },
          ],
          maxRetries: 0,
        },
      },
    }),
  });

  await waitForOperation(operation.name, args.accessToken);
  return jobPath;
}

async function triggerPlaywrightJob(args: {
  accessToken: string;
  cpu: number;
  envKeys: string[];
  globalEnvVars: Record<string, string>;
  imageUri: string;
  jobName: string;
  memory: number;
  payloadData: any;
  projectId: string;
  pubsubTopic: string;
}): Promise<string> {
  const jobPath = await ensurePlaywrightJob(args);
  const env = [
    { name: 'PAYLOAD', value: JSON.stringify(args.payloadData) },
    { name: 'PUBSUB_PROJECT_ID', value: args.projectId },
    { name: 'PUBSUB_TOPIC', value: args.pubsubTopic },
    { name: 'GCP_PROJECT', value: args.projectId },
    ...args.envKeys.map((key) => ({ name: key, value: args.globalEnvVars[key] || '' })),
  ];

  const operation = await cloudRunRequest<CloudRunOperation>(`${jobPath}:run`, args.accessToken, {
    method: 'POST',
    body: JSON.stringify({
      overrides: {
        containerOverrides: [{ env, name: 'playwright' }],
      },
    }),
  });
  const completedOperation = await waitForOperation(operation.name, args.accessToken);
  const executionName = requireRequestValue(completedOperation.response?.name, 'Cloud Run execution name');
  await waitForExecution(executionName, args.accessToken);
  return executionName;
}

export class GcpPlaywrightExecutionBackend implements PlaywrightExecutionBackend {
  supports(cloudProvider: string): boolean {
    return cloudProvider === 'GCP';
  }

  async execute(request: PlaywrightExecutionRequest): Promise<void> {
    const { config, envKeys, globalEnvVars, payloadData, publishLog, reqBody, runtime } = request;
    const projectId = requireRequestValue(reqBody.gcpProject, 'gcpProject');
    const accessToken = requireRequestValue(reqBody.settings?.gcp?.accessToken, 'GCP access token');
    const pubsubTopic = requireRequestValue(reqBody.pubsubTopic, 'pubsubTopic');
    const playwrightVersion = requireRequestValue(config.playwrightVersion, 'playwrightVersion');
    const cpu = requirePositiveNumber(config.cpu, 'cpu');
    const memory = requirePositiveNumber(config.memory, 'memory');
    const imageUri = resolvePlaywrightCloudImage(projectId, runtime, playwrightVersion);
    const jobName = resolveJobName(runtime, playwrightVersion, cpu, memory);

    await publishLog(`Playwright Runner starting in Cloud Run Job using ${runtime} image: ${imageUri}`, 'info');
    const executionName = await triggerPlaywrightJob({
      accessToken,
      cpu,
      envKeys,
      globalEnvVars,
      imageUri,
      jobName,
      memory,
      payloadData,
      projectId,
      pubsubTopic,
    });
    await publishLog(`Playwright Cloud Run Job (${executionName}) finished successfully.`, 'info');
  }
}