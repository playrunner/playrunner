import { randomUUID } from 'node:crypto';
import type { LogTransport } from './contracts';
import type { GcpPubSubEventTransport } from './gcp-pubsub-events';

type CloudRunOperation = {
  done?: boolean;
  error?: { message?: string };
  name: string;
  response?: { name?: string };
};

type CloudRunExecution = {
  conditions?: Array<{ state?: string; type?: string }>;
  createTime?: string;
  metadata?: { creationTimestamp?: string };
  name?: string;
};

type CloudRunExecutionsList = {
  executions?: CloudRunExecution[];
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

type WorkflowNodeState =
  | 'idle'
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'warning';

export type PrewarmedGcpPlaywrightRunner = {
  controlSubscriptionName: string;
  executionId: string;
  executionName?: string;
  jobPath: string;
  nodeId: string;
  projectId: string;
  runRequestedAt: number;
  statusSubscriptionName: string;
  topicName: string;
  type: 'gcp_pubsub_cloud_run_job';
};

const CLOUD_RUN_API_BASE_URL = 'https://run.googleapis.com/v2';
const PUBSUB_API_BASE_URL = 'https://pubsub.googleapis.com/v1';
const DEFAULT_PLAYWRIGHT_JOB_NAME_TEMPLATE = 'playrunner-{runtime}';
const EXECUTION_START_PREWARM_TIMEOUT_MS = 15 * 1000;
const POLL_INTERVAL_MS = 3000;
const MAX_TRANSIENT_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 1000;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const RUNNER_CONTROL_ACK_DEADLINE_SECONDS = 60;
const RUNNER_CONTROL_RETENTION_SECONDS = 24 * 60 * 60;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizePubSubId(value: string, fallback: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9._~%+-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 255);

  return sanitized || fallback;
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

function resolvePlaywrightRuntime(
  config: Record<string, any>,
): 'typescript' | 'python' {
  return config.testLanguage === 'python' || config.runtime === 'python'
    ? 'python'
    : 'typescript';
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

function getRunnerControlSubscriptionName(args: {
  executionId: string;
  nodeId: string;
}) {
  return sanitizePubSubId(
    `playrunner-runner-control-${args.executionId}-${args.nodeId}`,
    `playrunner-runner-control-${Date.now()}`,
  );
}

function getRunnerStatusSubscriptionName(args: {
  executionId: string;
  nodeId: string;
}) {
  return sanitizePubSubId(
    `playrunner-runner-status-${args.executionId}-${args.nodeId}`,
    `playrunner-runner-status-${Date.now()}`,
  );
}

function getExecutionCreateTime(execution: CloudRunExecution): number {
  const timestamp =
    execution.createTime || execution.metadata?.creationTimestamp || '';
  const parsed = timestamp ? Date.parse(timestamp) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function collectGlobalEnvVars(
  nodes: Record<string, any>[],
): Record<string, string> {
  const globalEnvVars: Record<string, string> = {};
  const envNodes = nodes.filter(
    (node) =>
      String(node.nodeType || node.label || '').toLowerCase() === 'environment',
  );

  for (const envNode of envNodes) {
    const variables = envNode.config?.variables;
    if (!Array.isArray(variables)) {
      continue;
    }

    for (const variable of variables) {
      if (variable?.enabled && variable.key) {
        globalEnvVars[variable.key] =
          variable.currentValue || variable.initialValue || '';
      }
    }
  }

  return globalEnvVars;
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
      response = await fetch(`${CLOUD_RUN_API_BASE_URL}/${resourcePath}`, {
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
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
      continue;
    }

    if (!response.ok) {
      const details = await response.text().catch(() => '');
      if (
        RETRYABLE_STATUS_CODES.has(response.status) &&
        attempt < MAX_TRANSIENT_RETRIES
      ) {
        lastError = new Error(
          `Cloud Run API returned ${response.status}: ${details}`,
        );
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
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

async function pubSubRequest<T>(
  resourcePath: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${PUBSUB_API_BASE_URL}/${resourcePath}`, {
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
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
      continue;
    }

    if (!response.ok) {
      const details = await response.text().catch(() => '');
      if (
        RETRYABLE_STATUS_CODES.has(response.status) &&
        attempt < MAX_TRANSIENT_RETRIES
      ) {
        lastError = new Error(
          `Pub/Sub API returned ${response.status}: ${details}`,
        );
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      throw new Error(`Pub/Sub API returned ${response.status}: ${details}`);
    }

    if (response.status === 204) {
      return {} as T;
    }

    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Pub/Sub API request failed after retries.');
}

async function publishGcpWorkflowLog(
  logTransport: LogTransport,
  params: {
    level?: 'debug' | 'error' | 'info' | 'warning' | 'warn';
    message: string;
    testId: string;
    type?: string;
    workflowId?: string;
  },
) {
  try {
    await logTransport.publish(
      JSON.stringify({
        cloudProvider: 'GCP',
        executionId: params.testId,
        level: params.level || 'info',
        message: params.message,
        testId: params.testId,
        timestamp: new Date().toISOString(),
        type: params.type || 'log',
        workflowId: params.workflowId,
      }),
    );
  } catch {
    // Ignore best-effort log transport failures.
  }
}

async function publishGcpWorkflowNodeState(
  logTransport: LogTransport,
  params: {
    nodeId: string;
    state: WorkflowNodeState;
    testId: string;
    workflowId?: string;
  },
) {
  try {
    await logTransport.publish(
      JSON.stringify({
        cloudProvider: 'GCP',
        executionId: params.testId,
        nodeId: params.nodeId,
        state: params.state,
        testId: params.testId,
        timestamp: new Date().toISOString(),
        type: 'node_state',
        workflowId: params.workflowId,
      }),
    );
  } catch {
    // Ignore best-effort status transport failures.
  }
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
    await sleep(POLL_INTERVAL_MS);
  }
}

async function waitForStartedExecution(args: {
  accessToken: string;
  jobPath: string;
  requestedAt: number;
  timeoutMs: number;
}): Promise<string> {
  const startedAt = Date.now();
  const minimumCreateTime = args.requestedAt - 5000;

  while (Date.now() - startedAt < args.timeoutMs) {
    const response = await cloudRunRequest<CloudRunExecutionsList>(
      `${args.jobPath}/executions`,
      args.accessToken,
    );
    const execution = (response.executions || [])
      .filter(
        (candidate) => getExecutionCreateTime(candidate) >= minimumCreateTime,
      )
      .sort((a, b) => getExecutionCreateTime(b) - getExecutionCreateTime(a))[0];

    if (execution?.name) {
      return execution.name;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for Playwright Cloud Run Execution to start for ${args.jobPath}.`,
  );
}

async function ensureRunnerSubscription(args: {
  accessToken: string;
  filter: string;
  projectId: string;
  subscriptionName: string;
  topicName: string;
}) {
  try {
    await pubSubRequest(
      `projects/${args.projectId}/subscriptions/${args.subscriptionName}`,
      args.accessToken,
      {
        body: JSON.stringify({
          ackDeadlineSeconds: RUNNER_CONTROL_ACK_DEADLINE_SECONDS,
          expirationPolicy: {
            ttl: `${RUNNER_CONTROL_RETENTION_SECONDS}s`,
          },
          filter: args.filter,
          messageRetentionDuration: `${RUNNER_CONTROL_RETENTION_SECONDS}s`,
          topic: `projects/${args.projectId}/topics/${args.topicName}`,
        }),
        method: 'PUT',
      },
    );
  } catch (error: any) {
    if (!error.message?.includes('Pub/Sub API returned 409')) {
      throw error;
    }
  }
}

async function deleteRunnerSubscription(args: {
  accessToken: string;
  projectId: string;
  subscriptionName: string;
}) {
  try {
    await pubSubRequest(
      `projects/${args.projectId}/subscriptions/${args.subscriptionName}`,
      args.accessToken,
      { method: 'DELETE' },
    );
  } catch (error: any) {
    if (!error.message?.includes('Pub/Sub API returned 404')) {
      throw error;
    }
  }
}

async function publishRunnerControlMessage(args: {
  accessToken: string;
  action: 'cancel' | 'start';
  executionId: string;
  nodeId: string;
  projectId: string;
  topicName: string;
}) {
  const eventId = randomUUID();
  const payload = {
    action: args.action,
    eventId,
    executionId: args.executionId,
    nodeId: args.nodeId,
    testId: args.executionId,
    timestamp: new Date().toISOString(),
    type: 'runner_control',
  };

  await pubSubRequest(
    `projects/${args.projectId}/topics/${args.topicName}:publish`,
    args.accessToken,
    {
      body: JSON.stringify({
        messages: [
          {
            attributes: {
              eventId,
              eventType: 'runner_control',
              executionId: args.executionId,
              messageKind: 'runner_control',
              nodeId: args.nodeId,
            },
            data: Buffer.from(JSON.stringify(payload), 'utf8').toString(
              'base64',
            ),
            orderingKey: `${args.executionId}:${args.nodeId}`,
          },
        ],
      }),
      method: 'POST',
    },
  );
}

async function ensureRunnerControlSubscriptions(args: {
  accessToken: string;
  controlSubscriptionName: string;
  executionId: string;
  nodeId: string;
  projectId: string;
  statusSubscriptionName: string;
  topicName: string;
}) {
  await Promise.all([
    ensureRunnerSubscription({
      accessToken: args.accessToken,
      filter: `attributes.executionId = "${args.executionId}" AND attributes.nodeId = "${args.nodeId}" AND attributes.messageKind = "runner_control"`,
      projectId: args.projectId,
      subscriptionName: args.controlSubscriptionName,
      topicName: args.topicName,
    }),
    ensureRunnerSubscription({
      accessToken: args.accessToken,
      filter: `attributes.executionId = "${args.executionId}" AND attributes.nodeId = "${args.nodeId}" AND attributes.messageKind = "runner_status"`,
      projectId: args.projectId,
      subscriptionName: args.statusSubscriptionName,
      topicName: args.topicName,
    }),
  ]);
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
  payloadData: Record<string, any>;
  projectId: string;
  workers: number;
}): Promise<{
  executionName?: string;
  jobPath: string;
  runRequestedAt: number;
}> {
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

  const runRequestedAt = Date.now();
  await cloudRunRequest<CloudRunOperation>(`${jobPath}:run`, args.accessToken, {
    method: 'POST',
    body: JSON.stringify({
      overrides: {
        containerOverrides: [{ env, name: 'playwright' }],
      },
    }),
  });

  try {
    const executionName = await waitForStartedExecution({
      accessToken: args.accessToken,
      jobPath,
      requestedAt: runRequestedAt,
      timeoutMs: EXECUTION_START_PREWARM_TIMEOUT_MS,
    });
    return { executionName, jobPath, runRequestedAt };
  } catch {
    return { jobPath, runRequestedAt };
  }
}

async function prewarmPlaywrightNode(args: {
  accessToken: string;
  body: Record<string, any>;
  bucketName: string;
  editorApiUrl: string;
  eventTransport: GcpPubSubEventTransport;
  executionToken: string;
  globalEnvVars: Record<string, string>;
  logTransport: LogTransport;
  node: Record<string, any>;
  projectId: string;
  testId: string;
  workflowId?: string;
}): Promise<PrewarmedGcpPlaywrightRunner> {
  const config = args.node.config || {};
  const runtime = resolvePlaywrightRuntime(config);
  const cpu = typeof config.cpu === 'number' ? config.cpu : 2;
  const memory = typeof config.memory === 'number' ? config.memory : 4;
  const workers = Number.isInteger(config.workers) ? config.workers : 1;
  const envKeys = Array.isArray(config.envVars) ? config.envVars : [];
  const playwrightVersion = config.playwrightVersion || 'latest';
  const gcpSettings = args.body.settings?.gcp || {};
  const controlSubscriptionName = getRunnerControlSubscriptionName({
    executionId: args.testId,
    nodeId: args.node.id,
  });
  const statusSubscriptionName = getRunnerStatusSubscriptionName({
    executionId: args.testId,
    nodeId: args.node.id,
  });
  const runnerControl = {
    controlSubscriptionName,
    projectId: args.projectId,
    topicName: args.eventTransport.topicName,
    type: 'gcp_pubsub' as const,
  };

  await publishGcpWorkflowLog(args.logTransport, {
    message: `Prewarming Playwright runner for ${args.node.label || args.node.id} (${args.node.id}).`,
    testId: args.testId,
    workflowId: args.workflowId,
  });
  await publishGcpWorkflowNodeState(args.logTransport, {
    nodeId: args.node.id,
    state: 'pending',
    testId: args.testId,
    workflowId: args.workflowId,
  });

  await ensureRunnerControlSubscriptions({
    accessToken: args.accessToken,
    controlSubscriptionName,
    executionId: args.testId,
    nodeId: args.node.id,
    projectId: args.projectId,
    statusSubscriptionName,
    topicName: args.eventTransport.topicName,
  });

  const payloadData = {
    data: {
      repository: config.repository,
      branch: config.branch,
      folder: config.folder,
      action: config.action,
      executionAuthToken: args.executionToken,
      testScript: config.testScript,
      nodeId: args.node.id,
      testId: args.testId,
      testLanguage: runtime,
      playwrightVersion,
      workers,
      editorApiUrl: args.editorApiUrl,
      eventTransport: args.eventTransport,
      bucketName: args.bucketName || null,
      cloudProvider: 'GCP',
      runnerControl,
    },
    github: args.body.settings?.github,
    settings: args.body.settings,
  };

  const imageUri = resolvePlaywrightCloudImage(
    args.projectId,
    runtime,
    playwrightVersion,
    gcpSettings.playwrightImageUriTemplate,
  );
  const jobName = resolveJobName(
    gcpSettings.playwrightJobNameTemplate ||
      DEFAULT_PLAYWRIGHT_JOB_NAME_TEMPLATE,
    runtime,
    playwrightVersion,
    cpu,
    memory,
  );
  const { executionName, jobPath, runRequestedAt } = await startPlaywrightJob({
    accessToken: args.accessToken,
    cpu,
    envKeys,
    globalEnvVars: args.globalEnvVars,
    imageUri,
    jobName,
    location: gcpSettings.cloudRunLocation,
    memory,
    payloadData,
    projectId: args.projectId,
    workers,
  });

  await publishGcpWorkflowLog(args.logTransport, {
    level: 'debug',
    message: executionName
      ? `Prewarmed Playwright Cloud Run Execution ${executionName} for ${args.node.id}.`
      : `Prewarmed Playwright Cloud Run Job ${jobName} for ${args.node.id}; execution is still being assigned.`,
    testId: args.testId,
    workflowId: args.workflowId,
  });

  return {
    controlSubscriptionName,
    executionId: args.testId,
    executionName,
    jobPath,
    nodeId: args.node.id,
    projectId: args.projectId,
    runRequestedAt,
    statusSubscriptionName,
    topicName: args.eventTransport.topicName,
    type: 'gcp_pubsub_cloud_run_job',
  };
}

export async function prewarmGcpPlaywrightRunners(args: {
  accessToken: string;
  body: Record<string, any>;
  bucketName: string;
  editorApiUrl: string;
  eventTransport: GcpPubSubEventTransport;
  executionToken: string;
  logTransport: LogTransport;
  projectId: string;
  testId: string;
  workflowId?: string;
}): Promise<Record<string, PrewarmedGcpPlaywrightRunner>> {
  const nodes = Array.isArray(args.body.nodes) ? args.body.nodes : [];
  const playwrightNodes = nodes.filter(
    (node: Record<string, any>) =>
      String(node.nodeType || node.label || '').toLowerCase() === 'playwright',
  );

  if (playwrightNodes.length === 0) {
    return {};
  }

  await publishGcpWorkflowLog(args.logTransport, {
    message: `Prewarming ${playwrightNodes.length} Playwright runner${playwrightNodes.length === 1 ? '' : 's'} while Cloud Run orchestrator starts.`,
    testId: args.testId,
    workflowId: args.workflowId,
  });

  const globalEnvVars = collectGlobalEnvVars(nodes);
  const settled = await Promise.allSettled(
    playwrightNodes.map((node: Record<string, any>) =>
      prewarmPlaywrightNode({
        ...args,
        globalEnvVars,
        node,
      }),
    ),
  );
  const runners: Record<string, PrewarmedGcpPlaywrightRunner> = {};

  for (let index = 0; index < settled.length; index++) {
    const result = settled[index];
    const node = playwrightNodes[index];

    if (result.status === 'fulfilled') {
      runners[result.value.nodeId] = result.value;
      continue;
    }

    await publishGcpWorkflowLog(args.logTransport, {
      level: 'warn',
      message: `Could not prewarm Playwright runner for ${node.id}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}. The orchestrator will prepare it when the workflow reaches the node.`,
      testId: args.testId,
      workflowId: args.workflowId,
    });
  }

  return runners;
}

export async function cancelPrewarmedGcpPlaywrightRunners(args: {
  accessToken: string;
  runners: Record<string, PrewarmedGcpPlaywrightRunner>;
}) {
  await Promise.allSettled(
    Object.values(args.runners).map(async (runner) => {
      await publishRunnerControlMessage({
        accessToken: args.accessToken,
        action: 'cancel',
        executionId: runner.executionId,
        nodeId: runner.nodeId,
        projectId: runner.projectId,
        topicName: runner.topicName,
      });
      await Promise.allSettled([
        deleteRunnerSubscription({
          accessToken: args.accessToken,
          projectId: runner.projectId,
          subscriptionName: runner.controlSubscriptionName,
        }),
        deleteRunnerSubscription({
          accessToken: args.accessToken,
          projectId: runner.projectId,
          subscriptionName: runner.statusSubscriptionName,
        }),
      ]);
    }),
  );
}
