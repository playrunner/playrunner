import { spawn } from 'child_process';
import path from 'path';
import crypto from 'crypto';

import fs from 'fs';

const EXECUTION_TOKEN_HEADER = 'x-execution-token';

type RunnerEventContext = {
  cloudProvider: string;
  editorApiUrl: string;
  executionToken: string;
  eventTransport?: {
    projectId?: string;
    topicName?: string;
    type?: 'gcp_pubsub';
  };
  gcpAccessToken?: string;
  nodeId?: string;
  testId: string;
};

type RunnerControlConfig = {
  controlSubscriptionName: string;
  projectId: string;
  topicName: string;
  type: 'gcp_pubsub';
};

type PreparedWorkingDirectory = {
  testLanguage: string;
  workingDir: string;
};

let runnerEventContext: RunnerEventContext | null = null;
const PUBSUB_API_BASE_URL = 'https://pubsub.googleapis.com/v1';
const CONTROL_POLL_INTERVAL_MS = 1000;
const CONTROL_SIGNAL_TIMEOUT_MS = 6 * 60 * 60 * 1000;

const BUNDLED_NODE_PACKAGES = new Set([
  '@playwright/test',
  'playwright',
  'ts-node',
  'typescript',
]);

function normalizeWorkers(value: unknown): number {
  const parsed =
    typeof value === 'string' && value.trim()
      ? Number(value)
      : typeof value === 'number'
        ? value
        : 1;
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return Math.min(100, Math.floor(parsed));
}

function getDependencyNames(packageJson: Record<string, any>): string[] {
  const dependencyBlocks = [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.optionalDependencies,
    packageJson.peerDependencies,
  ];
  return dependencyBlocks.flatMap((dependencies) =>
    dependencies && typeof dependencies === 'object'
      ? Object.keys(dependencies)
      : [],
  );
}

function getString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function getPubSubApiBaseUrl(): string {
  const emulatorHost = process.env.PUBSUB_EMULATOR_HOST?.trim();
  if (!emulatorHost) {
    return PUBSUB_API_BASE_URL;
  }

  const normalizedHost = emulatorHost.replace(/\/+$/, '');
  return `${normalizedHost.startsWith('http') ? normalizedHost : `http://${normalizedHost}`}/v1`;
}

function isUsingPubSubEmulator(): boolean {
  return !!process.env.PUBSUB_EMULATOR_HOST?.trim();
}

async function publishGcpPubSubEvent(payload: Record<string, unknown>) {
  const eventTransport = runnerEventContext?.eventTransport;
  if (!eventTransport) {
    throw new Error('Runner event transport is required.');
  }

  if (
    eventTransport.type !== 'gcp_pubsub' ||
    !eventTransport.projectId ||
    !eventTransport.topicName
  ) {
    throw new Error('Pub/Sub event transport is missing project or topic.');
  }

  if (
    !runnerEventContext?.executionToken ||
    !runnerEventContext.testId ||
    (!runnerEventContext.gcpAccessToken && !isUsingPubSubEmulator())
  ) {
    throw new Error('Pub/Sub event transport context is incomplete.');
  }

  const eventId = getString(payload.eventId) || crypto.randomUUID();
  const eventPayload: Record<string, unknown> = {
    executionAuthToken: runnerEventContext.executionToken,
    executionId: runnerEventContext.testId,
    nodeId: runnerEventContext.nodeId,
    testId: runnerEventContext.testId,
    ...payload,
    eventId,
  };
  const eventType = getString(eventPayload.type) || 'event';
  const response = await fetch(
    `${getPubSubApiBaseUrl()}/projects/${eventTransport.projectId}/topics/${eventTransport.topicName}:publish`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(runnerEventContext.gcpAccessToken
          ? { Authorization: `Bearer ${runnerEventContext.gcpAccessToken}` }
          : {}),
      },
      body: JSON.stringify({
        messages: [
          {
            attributes: {
              cloudProvider: runnerEventContext.cloudProvider,
              eventId,
              eventType,
              executionId: runnerEventContext.testId,
              messageKind: 'workflow_event',
              nodeId: runnerEventContext.nodeId || '',
            },
            data: Buffer.from(JSON.stringify(eventPayload), 'utf8').toString(
              'base64',
            ),
            orderingKey: runnerEventContext.testId,
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(
      `Pub/Sub publish failed (${response.status}): ${details.slice(0, 500)}`,
    );
  }
}

async function publishEvent(payload: Record<string, unknown>) {
  if (!runnerEventContext?.executionToken || !runnerEventContext.testId) {
    return;
  }

  try {
    await publishGcpPubSubEvent(payload);
  } catch (error) {
    console.error('Failed to publish runner event:', error);
  }
}

async function publishLog(message: string, level: 'info' | 'error' = 'info') {
  const formattedMessage = `[Playwright Runner] ${message}`;
  if (level === 'error') {
    console.error(formattedMessage);
  } else {
    console.log(formattedMessage);
  }

  await publishEvent({
    level,
    message: formattedMessage,
    timestamp: new Date().toISOString(),
    type: 'log',
  });
}

async function publishNodeState(
  state: 'idle' | 'pending' | 'running' | 'success' | 'error' | 'warning',
) {
  await publishEvent({
    state,
    timestamp: new Date().toISOString(),
    type: 'node_state',
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pubSubRequest<T>(
  resourcePath: string,
  accessToken: string | undefined,
  init: RequestInit = {},
): Promise<T> {
  if (!accessToken && !isUsingPubSubEmulator()) {
    throw new Error('Pub/Sub access token is required.');
  }

  const response = await fetch(`${getPubSubApiBaseUrl()}/${resourcePath}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(
      `Pub/Sub API returned ${response.status}: ${details.slice(0, 500)}`,
    );
  }

  if (response.status === 204) {
    return {} as T;
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

async function publishRunnerStatus(
  control: RunnerControlConfig | undefined,
  status: 'cancelled' | 'failed' | 'prepare_failed' | 'ready' | 'started',
  error?: string,
) {
  if (!control || !runnerEventContext?.testId || !runnerEventContext.nodeId) {
    return;
  }

  const accessToken = runnerEventContext.gcpAccessToken;
  const eventId = crypto.randomUUID();
  const payload = {
    error,
    eventId,
    executionId: runnerEventContext.testId,
    nodeId: runnerEventContext.nodeId,
    status,
    testId: runnerEventContext.testId,
    timestamp: new Date().toISOString(),
    type: 'runner_status',
  };
  await pubSubRequest(
    `projects/${control.projectId}/topics/${control.topicName}:publish`,
    accessToken,
    {
      body: JSON.stringify({
        messages: [
          {
            attributes: {
              eventId,
              eventType: 'runner_status',
              executionId: runnerEventContext.testId,
              messageKind: 'runner_status',
              nodeId: runnerEventContext.nodeId,
            },
            data: Buffer.from(JSON.stringify(payload), 'utf8').toString(
              'base64',
            ),
            orderingKey: `${runnerEventContext.testId}:${runnerEventContext.nodeId}`,
          },
        ],
      }),
      method: 'POST',
    },
  );
}

function decodePubSubPayload(message: { data?: string }): Record<string, any> {
  if (!message.data) {
    return {};
  }
  return JSON.parse(Buffer.from(message.data, 'base64').toString('utf8'));
}

async function acknowledgeControlMessages(args: {
  ackIds: string[];
  control: RunnerControlConfig;
  gcpAccessToken: string | undefined;
}) {
  if (args.ackIds.length === 0) {
    return;
  }

  await pubSubRequest(
    `projects/${args.control.projectId}/subscriptions/${args.control.controlSubscriptionName}:acknowledge`,
    args.gcpAccessToken,
    {
      body: JSON.stringify({ ackIds: args.ackIds }),
      method: 'POST',
    },
  );
}

async function waitForPubSubStartSignal(control: RunnerControlConfig) {
  const gcpAccessToken = runnerEventContext?.gcpAccessToken;
  const executionId = runnerEventContext?.testId;
  const nodeId = runnerEventContext?.nodeId;
  if (
    (!gcpAccessToken && !isUsingPubSubEmulator()) ||
    !executionId ||
    !nodeId
  ) {
    throw new Error('Missing GCP runner control context.');
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < CONTROL_SIGNAL_TIMEOUT_MS) {
    const response = await pubSubRequest<{
      receivedMessages?: Array<{
        ackId: string;
        message: { data?: string };
      }>;
    }>(
      `projects/${control.projectId}/subscriptions/${control.controlSubscriptionName}:pull`,
      gcpAccessToken,
      {
        body: JSON.stringify({ maxMessages: 10, returnImmediately: true }),
        method: 'POST',
      },
    );
    const messages = response.receivedMessages || [];
    const ackIds = messages.map((message) => message.ackId);

    try {
      for (const message of messages) {
        const payload = decodePubSubPayload(message.message);
        if (payload.executionId !== executionId || payload.nodeId !== nodeId) {
          continue;
        }
        if (payload.action === 'start' || payload.action === 'cancel') {
          return payload.action;
        }
      }
    } finally {
      await acknowledgeControlMessages({
        ackIds,
        control,
        gcpAccessToken,
      });
    }

    await sleep(CONTROL_POLL_INTERVAL_MS);
  }

  throw new Error('Timed out waiting for Playwright runner start signal.');
}

async function waitForStartSignal(control: RunnerControlConfig | undefined) {
  if (!control) {
    return 'start';
  }

  return waitForPubSubStartSignal(control);
}

async function installTypescriptDependencies(
  workingDir: string,
): Promise<void> {
  const packageJsonPath = path.join(workingDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return;
  }

  const nodeModulesPath = path.join(workingDir, 'node_modules');
  if (fs.existsSync(nodeModulesPath)) {
    await publishLog('Using existing node_modules directory.');
    return;
  }

  let packageJson: Record<string, any>;
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  } catch (error: any) {
    throw new Error(`Failed to parse package.json: ${error.message}`);
  }

  const dependencyNames = getDependencyNames(packageJson);
  const hasExternalDependencies = dependencyNames.some(
    (name) => !BUNDLED_NODE_PACKAGES.has(name) && !name.startsWith('@types/'),
  );

  if (!hasExternalDependencies) {
    await publishLog(
      'Using runner-bundled Playwright dependencies; skipping npm install.',
    );
    return;
  }

  const hasLockfile = fs.existsSync(path.join(workingDir, 'package-lock.json'));
  const args = hasLockfile
    ? ['ci', '--prefer-offline', '--no-audit', '--no-fund']
    : ['install', '--prefer-offline', '--no-audit', '--no-fund'];
  await publishLog(
    hasLockfile
      ? 'Installing npm dependencies with npm ci...'
      : 'Installing npm dependencies...',
  );
  await new Promise<void>((resolve, reject) => {
    const install = spawn('npm', args, { cwd: workingDir });
    install.stdout.on('data', (data) =>
      console.log(`[npm]: ${data.toString().trim()}`),
    );
    install.stderr.on('data', (data) =>
      console.error(`[npm error]: ${data.toString().trim()}`),
    );
    install.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`npm ${args[0]} failed with code ${code}`)),
    );
  });
}

function resolvePlaywrightCommand(workingDir: string): {
  args: string[];
  command: string;
} {
  const localBin = path.join(workingDir, 'node_modules', '.bin', 'playwright');
  if (fs.existsSync(localBin)) {
    return { command: localBin, args: ['test'] };
  }

  const runnerBin = path.join(
    process.cwd(),
    'node_modules',
    '.bin',
    'playwright',
  );
  if (fs.existsSync(runnerBin)) {
    return { command: runnerBin, args: ['test'] };
  }

  return { command: 'npx', args: ['--no-install', 'playwright', 'test'] };
}

function prepareInlineTypescriptTest(
  testScript: string,
  nodeId?: string,
): string {
  const safeNodeId = (nodeId || 'default').replace(/[^a-zA-Z0-9_-]/g, '-');
  const workingDir = path.join(process.cwd(), 'inline-tests', safeNodeId);
  fs.rmSync(workingDir, { force: true, recursive: true });
  fs.mkdirSync(workingDir, { recursive: true });
  fs.writeFileSync(
    path.join(workingDir, 'playrunner-inline.spec.ts'),
    testScript,
  );
  return workingDir;
}

async function runTypescriptTest(
  workingDir: string,
  workers: number,
): Promise<void> {
  await publishLog(`Executing TypeScript Playwright flow in ${workingDir}...`);

  const command = resolvePlaywrightCommand(workingDir);
  const args = [...command.args];
  let configMsg = 'default config';
  if (fs.existsSync(path.join(workingDir, 'playwright.service.config.ts'))) {
    args.push('--config', 'playwright.service.config.ts');
    configMsg = 'playwright.service.config.ts';
  }
  args.push('--workers', String(workers));

  await publishLog(
    `Running Playwright test using ${configMsg} with ${workers} worker${workers === 1 ? '' : 's'}...`,
  );
  await new Promise<void>((resolve, reject) => {
    const testProc = spawn(command.command, args, { cwd: workingDir });
    testProc.stdout.on('data', (data) =>
      console.log(`[playwright]: ${data.toString().trim()}`),
    );
    testProc.stderr.on('data', (data) =>
      console.error(`[playwright error]: ${data.toString().trim()}`),
    );
    testProc.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Tests failed with code ${code}`)),
    );
  });
}

async function runPythonTest(workingDir: string): Promise<void> {
  await publishLog(`Executing Python Playwright flow in ${workingDir}...`);

  await publishLog('Running pytest...');
  await new Promise<void>((resolve, reject) => {
    const testProc = spawn('pytest', [], { cwd: workingDir });
    testProc.stdout.on('data', (data) =>
      console.log(`[pytest]: ${data.toString().trim()}`),
    );
    testProc.stderr.on('data', (data) =>
      console.error(`[pytest error]: ${data.toString().trim()}`),
    );
    testProc.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Tests failed with code ${code}`)),
    );
  });
}

async function uploadOutputs(
  workingDir: string,
  nodeId: string,
  testId: string,
  editorApiUrl: string,
  executionAuthToken?: string,
  bucketName?: string,
  accessToken?: string,
  gcpProject?: string,
  cloudProvider: string = 'LOCAL_RUNNER',
) {
  if (!nodeId || !testId) {
    await publishLog('Missing nodeId or testId, skipping output upload.');
    return;
  }

  await publishLog(`Preparing test outputs for node ${nodeId}...`);

  const hasPlaywrightReport = fs.existsSync(
    path.join(workingDir, 'playwright-report'),
  );
  const hasTestResults = fs.existsSync(path.join(workingDir, 'test-results'));

  if (!hasPlaywrightReport && !hasTestResults) {
    await publishLog(
      'No playwright-report or test-results directory found. Skipping output upload.',
    );
    return;
  }

  try {
    if (cloudProvider === 'GCP' && bucketName && accessToken && gcpProject) {
      const outputData: any = {};

      if (hasPlaywrightReport) {
        outputData.reportUrl = `/outputs/${testId}/${nodeId}/playwright-report/index.html`;
      }

      if (hasTestResults) {
        const findVideos = (dir: string): string[] => {
          let results: string[] = [];
          const list = fs.readdirSync(dir);
          list.forEach((file) => {
            const fileRoute = path.join(dir, file);
            const stat = fs.statSync(fileRoute);
            if (stat && stat.isDirectory()) {
              results = results.concat(findVideos(fileRoute));
            } else if (file.endsWith('.webm') || file.endsWith('.png')) {
              results.push(fileRoute);
            }
          });
          return results;
        };
        const mediaFiles = findVideos(path.join(workingDir, 'test-results'));
        if (mediaFiles.length > 0) {
          outputData.media = mediaFiles.map(
            (v) =>
              `/outputs/${testId}/${nodeId}/${path.relative(workingDir, v)}`,
          );
        }
      }

      await publishLog(
        `Uploading outputs directly to GCS bucket ${bucketName}...`,
      );
      const [{ Storage }, { OAuth2Client }] = await Promise.all([
        import('@google-cloud/storage'),
        import('google-auth-library'),
      ]);
      const oauth2Client = new OAuth2Client();
      oauth2Client.setCredentials({ access_token: accessToken });

      const authClient = {
        getRequestHeaders: async (url?: string) => {
          const headers = await oauth2Client.getRequestHeaders(url);
          const plainHeaders: Record<string, string> = {};
          if (headers && typeof (headers as any).forEach === 'function') {
            (headers as any).forEach((value: string, key: string) => {
              plainHeaders[key] = value;
            });
          } else if (headers) {
            Object.assign(plainHeaders, headers);
          }
          return plainHeaders;
        },
        request: async (opts: any) => {
          if (opts.uri && !opts.url) opts.url = opts.uri;
          const res = await oauth2Client.request(opts);
          if (
            res &&
            res.headers &&
            typeof (res.headers as any).forEach === 'function'
          ) {
            const plainHeaders: Record<string, string> = {};
            (res.headers as any).forEach((value: string, key: string) => {
              plainHeaders[key] = value;
            });
            return new Proxy(res, {
              get(target, prop) {
                if (prop === 'headers') return plainHeaders;
                const value = target[prop as keyof typeof target];
                if (typeof value === 'function') return value.bind(target);
                return value;
              },
            });
          }
          return res;
        },
      };

      const storage = new Storage({
        projectId: gcpProject,
        authClient: authClient as any,
      });
      const bucket = storage.bucket(bucketName);

      const uploadDirToGcs = async (localDir: string, gcsPrefix: string) => {
        const files = fs.readdirSync(localDir);
        for (const file of files) {
          const localPath = path.join(localDir, file);
          const gcsPath = `${gcsPrefix}/${file}`;
          if (fs.statSync(localPath).isDirectory()) {
            await uploadDirToGcs(localPath, gcsPath);
          } else {
            await bucket.upload(localPath, { destination: gcsPath });
          }
        }
      };

      if (hasPlaywrightReport)
        await uploadDirToGcs(
          path.join(workingDir, 'playwright-report'),
          `${testId}/${nodeId}/playwright-report`,
        );
      if (hasTestResults)
        await uploadDirToGcs(
          path.join(workingDir, 'test-results'),
          `${testId}/${nodeId}/test-results`,
        );

      await publishEvent({
        nodeId,
        output: outputData,
        timestamp: new Date().toISOString(),
        type: 'node_output',
      });
    } else {
      if (!executionAuthToken) {
        throw new Error('Missing executionAuthToken for local output upload.');
      }

      await publishLog(
        `Uploading outputs to editor API at ${editorApiUrl} for local execution.`,
      );
      const outputDirs = [];
      if (hasPlaywrightReport) outputDirs.push('playwright-report');
      if (hasTestResults) outputDirs.push('test-results');

      const archiveBuffer = await new Promise<Buffer>((resolve, reject) => {
        const tarProcess = spawn('tar', ['-czf', '-', ...outputDirs], {
          cwd: workingDir,
        });
        const chunks: Buffer[] = [];

        tarProcess.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
        tarProcess.stderr.on('data', (data) =>
          console.error(`[tar error]: ${data.toString().trim()}`),
        );
        tarProcess.on('close', (code) => {
          if (code === 0) resolve(Buffer.concat(chunks));
          else reject(new Error(`tar failed with code ${code}`));
        });
        tarProcess.on('error', reject);
      });

      const uploadUrl = new URL(
        `/api/outputs/${testId}/${nodeId}`,
        editorApiUrl,
      );
      if (bucketName) uploadUrl.searchParams.set('bucketName', bucketName);

      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/gzip',
          [EXECUTION_TOKEN_HEADER]: executionAuthToken,
        },
        body: new Uint8Array(archiveBuffer),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Editor API upload failed (${response.status}): ${errorText}`,
        );
      }

      const uploadResult = (await response.json().catch(() => null)) as {
        output?: Record<string, unknown>;
      } | null;
      await publishEvent({
        nodeId,
        output: uploadResult?.output || {},
        timestamp: new Date().toISOString(),
        type: 'node_output',
      });
    }

    await publishLog('Outputs processed successfully.');
  } catch (err: any) {
    await publishLog(`Failed to process outputs: ${err.message}`, 'error');
  }
}

async function prepareWorkingDirectory(
  payload: any,
): Promise<PreparedWorkingDirectory> {
  let workingDir = __dirname;
  let isCloned = false;

  if (
    payload?.data?.action === 'clone' ||
    (!payload?.data?.action && payload?.data?.repository)
  ) {
    if (payload?.data?.repository) {
      const repo = payload.data.repository;
      const branch = payload.data.branch || 'main';
      const token = payload?.github?.accessToken;

      await publishLog(`Cloning repository ${repo} on branch ${branch}...`);

      const cloneUrl = token
        ? `https://x-access-token:${token}@github.com/${repo}.git`
        : `https://github.com/${repo}.git`;

      try {
        await new Promise<void>((resolve, reject) => {
          const gitProcess = spawn('git', [
            'clone',
            '--depth',
            '1',
            '-b',
            branch,
            '--single-branch',
            cloneUrl,
            '/app/repo',
          ]);

          gitProcess.stdout.on('data', (data) =>
            console.log(`[Git]: ${data.toString().trim()}`),
          );
          gitProcess.stderr.on('data', (data) =>
            console.error(`[Git Error]: ${data.toString().trim()}`),
          );

          gitProcess.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Git clone failed with code ${code}`));
          });
        });
        await publishLog('Repository cloned successfully.');
        workingDir = path.join('/app/repo', payload?.data?.folder || '/');
        isCloned = true;
      } catch (err: any) {
        throw new Error(`Clone Error: ${err.message}`);
      }
    } else {
      throw new Error('Missing repository for cloning.');
    }
  }

  let testLanguage = payload?.data?.testLanguage || 'typescript';

  if (
    payload?.data?.action === 'run' &&
    typeof payload?.data?.testScript === 'string' &&
    payload.data.testScript.trim()
  ) {
    workingDir = prepareInlineTypescriptTest(
      payload.data.testScript,
      payload?.data?.nodeId,
    );
    testLanguage = 'typescript';
    await publishLog('Prepared inline Playwright script.');
  }

  if (isCloned) {
    if (
      fs.existsSync(path.join(workingDir, 'requirements.txt')) ||
      fs.existsSync(path.join(workingDir, 'pytest.ini'))
    ) {
      testLanguage = 'python';
    } else {
      testLanguage = 'typescript';
    }
  } else {
    testLanguage = payload?.data?.testLanguage || 'typescript';
  }

  if (testLanguage === 'typescript') {
    await installTypescriptDependencies(workingDir);
  }

  return { testLanguage, workingDir };
}

async function parsePayload() {
  if (!process.env.PAYLOAD) {
    return null;
  }

  try {
    return JSON.parse(process.env.PAYLOAD);
  } catch {
    return null;
  }
}

function requiredEditorApiUrl(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  throw new Error(
    'PAYLOAD.data.editorApiUrl is required for runner callbacks. Pass the value from apps/api/.env EDITOR_API_URL_DOCKER.',
  );
}

async function run() {
  const payload = await parsePayload();
  const testId = payload?.data?.testId || crypto.randomUUID();
  const cloudProvider = payload?.data?.cloudProvider || 'LOCAL_RUNNER';
  const runnerControl = payload?.data?.runnerControl as
    | RunnerControlConfig
    | undefined;
  runnerEventContext = {
    cloudProvider,
    editorApiUrl: requiredEditorApiUrl(payload?.data?.editorApiUrl),
    executionToken: payload?.data?.executionAuthToken || '',
    eventTransport: payload?.data?.eventTransport,
    gcpAccessToken: payload?.settings?.gcp?.accessToken,
    nodeId: payload?.data?.nodeId,
    testId,
  };

  const envType = cloudProvider === 'GCP' ? 'GCP Cloud Run' : 'Local Docker';
  await publishLog(
    `Playwright runner container started in ${envType}. Preparing dependencies for Test ID: ${testId}`,
  );

  let prepared: PreparedWorkingDirectory;
  try {
    prepared = await prepareWorkingDirectory(payload);
    await publishLog(
      'Playwright runner prepared and waiting for start signal.',
    );
    await publishRunnerStatus(runnerControl, 'ready');
  } catch (err: any) {
    await publishLog(`Playwright Prepare Error: ${err.message}`, 'error');
    await publishRunnerStatus(runnerControl, 'prepare_failed', err.message);
    process.exit(1);
  }

  let action: string;
  try {
    action = await waitForStartSignal(runnerControl);
  } catch (err: any) {
    await publishLog(`Playwright Control Error: ${err.message}`, 'error');
    await publishRunnerStatus(runnerControl, 'failed', err.message);
    process.exit(1);
  }

  if (action === 'cancel') {
    await publishLog('Playwright runner cancelled before test start.');
    await publishRunnerStatus(runnerControl, 'cancelled');
    process.exit(0);
  }

  await publishRunnerStatus(runnerControl, 'started');
  await publishNodeState('running');
  await publishLog('Start signal received. Running Playwright test.');

  const workers = normalizeWorkers(
    payload?.data?.workers || process.env.PLAYWRIGHT_WORKERS,
  );
  let testFailed = false;
  try {
    if (prepared.testLanguage === 'python') {
      await runPythonTest(prepared.workingDir);
    } else {
      await runTypescriptTest(prepared.workingDir, workers);
    }

    await publishLog('Job complete.');
  } catch (err: any) {
    testFailed = true;
    await publishLog(`Playwright Error: ${err.message}`, 'error');
  }

  await uploadOutputs(
    prepared.workingDir,
    payload?.data?.nodeId,
    testId,
    payload?.data?.editorApiUrl,
    payload?.data?.executionAuthToken,
    payload?.data?.bucketName,
    payload?.settings?.gcp?.accessToken,
    payload?.settings?.gcp?.selectedProject,
    cloudProvider,
  );

  process.exit(testFailed ? 1 : 0);
}

run();
