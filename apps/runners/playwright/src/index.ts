import { spawn } from 'child_process';
import path from 'path';
import crypto from 'crypto';

import fs from 'fs';
import { readPlaywrightReportData } from './report-data';
import {
  createBlobArtifact,
  readPlaywrightDiscoveryReport,
  validateBlobArtifacts,
  verifyBlobArtifact,
  type PlaywrightBlobArtifact,
} from './sharding';
import { describePlaywrightProcessExit } from './process-exit';
import {
  readPlaywrightExecutionEnvironment,
  readPlaywrightPayload,
} from './payload';
import {
  createGitCredentialEnvironment,
  normalizeGitHubRepository,
  resolveRepositoryWorkingDirectory,
} from './repository';
import {
  createRunnerControlClient,
  type RunnerControlClient,
  type RunnerControlConfig,
  type RunnerDiagnosticLog,
} from '../../shared/runner-control';

const EXECUTION_TOKEN_HEADER = 'x-execution-token';
let selectedExecutionEnvironment: Record<string, string> = {};

function repositoryProcessEnvironment(
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return { ...process.env, ...selectedExecutionEnvironment, ...extra };
}

type RunnerEventContext = {
  childKind?: 'aggregate' | 'discovery' | 'shard';
  cloudProvider: string;
  editorApiUrl: string;
  executionToken: string;
  eventTransport?: {
    projectId?: string;
    topicName?: string;
    type?: 'gcp_pubsub';
  };
  gcpAccessToken?: string;
  logicalNodeId?: string;
  nodeId?: string;
  shardIndex?: number;
  shardTotal?: number;
  testId: string;
};

type PreparedWorkingDirectory = {
  sourceRevision?: string;
  testLanguage: string;
  workingDir: string;
};

let runnerEventContext: RunnerEventContext | null = null;
let runnerControlClient: RunnerControlClient | null = null;
const runnerDiagnosticLogs: RunnerDiagnosticLog[] = [];

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

async function publishEvent(payload: Record<string, unknown>) {
  await runnerControlClient?.publishEvent(payload);
}

async function publishLog(message: string, level: 'info' | 'error' = 'info') {
  if (runnerControlClient) {
    await runnerControlClient.log(message, level);
  } else if (level === 'error') {
    console.error(`[Playwright Runner] ${message}`);
  } else {
    console.log(`[Playwright Runner] ${message}`);
  }
}

async function publishNodeState(
  state: 'pending' | 'running' | 'success' | 'error' | 'warning',
) {
  await runnerControlClient?.publishNodeState(state);
}

async function publishRunnerStatus(
  control: RunnerControlConfig | undefined,
  status:
    | 'cancelled'
    | 'completed'
    | 'failed'
    | 'prepare_failed'
    | 'ready'
    | 'started',
  error?: string,
  output?: Record<string, unknown>,
) {
  if (control) {
    await runnerControlClient?.publishStatus(status, error, output);
  }
}

async function waitForStartSignal(control: RunnerControlConfig | undefined) {
  if (!control) {
    return 'start';
  }

  if (!runnerControlClient) {
    throw new Error('Playwright runner control client is unavailable.');
  }
  return runnerControlClient.waitForStartSignal();
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
    const install = spawn('npm', args, {
      cwd: workingDir,
      env: repositoryProcessEnvironment(),
    });
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
  shard?: { index: number; total: number },
): Promise<void> {
  await publishLog(`Executing TypeScript Playwright flow in ${workingDir}...`);

  const command = resolvePlaywrightCommand(workingDir);
  const args = [...command.args];
  let configMsg = 'default config';
  if (fs.existsSync(path.join(workingDir, 'playwright.service.config.ts'))) {
    args.push('--config', 'playwright.service.config.ts');
    configMsg = 'playwright.service.config.ts';
  }
  if (shard) {
    args.push(`--shard=${shard.index}/${shard.total}`);
    args.push('--reporter=blob');
  } else {
    args.push('--reporter=html,json');
  }
  args.push('--workers', String(workers));

  await publishLog(
    `Running Playwright test using ${configMsg} with ${workers} worker${workers === 1 ? '' : 's'}...`,
  );
  await new Promise<void>((resolve, reject) => {
    const testProc = spawn(command.command, args, {
      cwd: workingDir,
      env: {
        ...repositoryProcessEnvironment(),
        ...(shard
          ? {
              CI: 'true',
              PLAYWRIGHT_BLOB_OUTPUT_DIR: 'blob-report',
            }
          : {}),
        PLAYWRIGHT_HTML_OPEN: 'never',
        PLAYWRIGHT_HTML_OUTPUT_DIR: 'playwright-report',
        PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(
          'playwright-report',
          'report.json',
        ),
      },
    });
    testProc.stdout.on('data', (data) =>
      console.log(`[playwright]: ${data.toString().trim()}`),
    );
    testProc.stderr.on('data', (data) =>
      console.error(`[playwright error]: ${data.toString().trim()}`),
    );
    testProc.on('close', (code, signal) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              describePlaywrightProcessExit({
                code,
                sharded: Boolean(shard),
                signal,
              }),
            ),
          ),
    );
  });
}

async function discoverTypescriptTests(
  workingDir: string,
  sourceRevision?: string,
) {
  const discoveryDirectory = path.join(workingDir, 'playwright-discovery');
  fs.rmSync(discoveryDirectory, { force: true, recursive: true });
  fs.mkdirSync(discoveryDirectory, { recursive: true });
  const reportPath = path.join(discoveryDirectory, 'report.json');
  const command = resolvePlaywrightCommand(workingDir);
  const args = [...command.args];
  if (fs.existsSync(path.join(workingDir, 'playwright.service.config.ts'))) {
    args.push('--config', 'playwright.service.config.ts');
  }
  args.push('--list', '--reporter=json');

  await publishLog('Collecting the Playwright suite without running tests...');
  await new Promise<void>((resolve, reject) => {
    const discoveryProcess = spawn(command.command, args, {
      cwd: workingDir,
      env: {
        ...repositoryProcessEnvironment(),
        PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath,
      },
    });
    discoveryProcess.stdout.on('data', (data) =>
      console.log(`[playwright discovery]: ${data.toString().trim()}`),
    );
    discoveryProcess.stderr.on('data', (data) =>
      console.error(`[playwright discovery error]: ${data.toString().trim()}`),
    );
    discoveryProcess.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Playwright discovery failed with code ${code}`)),
    );
  });

  return readPlaywrightDiscoveryReport({ reportPath, sourceRevision });
}

async function runPythonTest(workingDir: string): Promise<void> {
  await publishLog(`Executing Python Playwright flow in ${workingDir}...`);

  await publishLog('Running pytest...');
  await new Promise<void>((resolve, reject) => {
    const testProc = spawn('pytest', [], {
      cwd: workingDir,
      env: repositoryProcessEnvironment(),
    });
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

async function createAuthenticatedStorage(
  projectId: string,
  accessToken: string,
) {
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
      const response = await oauth2Client.request(opts);
      if (
        response?.headers &&
        typeof (response.headers as any).forEach === 'function'
      ) {
        const plainHeaders: Record<string, string> = {};
        (response.headers as any).forEach((value: string, key: string) => {
          plainHeaders[key] = value;
        });
        return new Proxy(response, {
          get(target, prop) {
            if (prop === 'headers') return plainHeaders;
            const value = target[prop as keyof typeof target];
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      }
      return response;
    },
  };
  return new Storage({ projectId, authClient: authClient as any });
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
  blobArtifact?: PlaywrightBlobArtifact,
): Promise<Record<string, unknown>> {
  if (!nodeId || !testId) {
    await publishLog('Missing nodeId or testId, skipping output upload.');
    return {};
  }

  await publishLog(`Preparing test outputs for node ${nodeId}...`);

  const hasPlaywrightReport = fs.existsSync(
    path.join(workingDir, 'playwright-report'),
  );
  const hasTestResults = fs.existsSync(path.join(workingDir, 'test-results'));
  const hasBlobReport = fs.existsSync(path.join(workingDir, 'blob-report'));

  if (!hasPlaywrightReport && !hasTestResults && !hasBlobReport) {
    await publishLog(
      'No Playwright report, blob report, or test results found. Skipping output upload.',
    );
    return {};
  }

  try {
    const reportPath = path.join(
      workingDir,
      'playwright-report',
      'report.json',
    );
    const reportOutput: Record<string, unknown> = {
      ...(blobArtifact ? { blobArtifact } : {}),
    };
    if (hasPlaywrightReport && fs.existsSync(reportPath)) {
      const report = readPlaywrightReportData({
        nodeId,
        reportPath,
        testId,
        workingDir,
      });
      reportOutput.reportDataUrl = `/outputs/${testId}/${nodeId}/playwright-report/report.json`;
      reportOutput.report = report;
      if (report) {
        fs.writeFileSync(
          path.join(workingDir, 'playwright-report', 'report-summary.json'),
          JSON.stringify(report),
        );
      }
    }

    if (cloudProvider === 'GCP' && bucketName && accessToken && gcpProject) {
      const outputData: Record<string, unknown> = { ...reportOutput };

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
      const storage = await createAuthenticatedStorage(gcpProject, accessToken);
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
      if (hasBlobReport)
        await uploadDirToGcs(
          path.join(workingDir, 'blob-report'),
          `${testId}/${nodeId}/blob-report`,
        );

      await publishEvent({
        nodeId: runnerEventContext?.nodeId || nodeId,
        output: outputData,
        timestamp: new Date().toISOString(),
        type: 'node_output',
      });
      await publishLog('Outputs processed successfully.');
      return outputData;
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
      if (hasBlobReport) outputDirs.push('blob-report');

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
      const output = {
        ...(uploadResult?.output || {}),
        ...reportOutput,
      };
      await publishEvent({
        nodeId: runnerEventContext?.nodeId || nodeId,
        output,
        timestamp: new Date().toISOString(),
        type: 'node_output',
      });
      await publishLog('Outputs processed successfully.');
      return output;
    }
  } catch (err: any) {
    await publishLog(`Failed to process outputs: ${err.message}`, 'error');
    return {};
  }
}

async function prepareWorkingDirectory(
  payload: any,
): Promise<PreparedWorkingDirectory> {
  if (payload?.data?.executionMode === 'aggregate') {
    const workingDir = path.join(
      process.cwd(),
      'aggregate-reports',
      String(payload?.data?.nodeId || 'default').replace(
        /[^a-zA-Z0-9_-]/g,
        '-',
      ),
    );
    fs.rmSync(workingDir, { force: true, recursive: true });
    fs.mkdirSync(workingDir, { recursive: true });
    return { testLanguage: 'typescript', workingDir };
  }

  let workingDir = __dirname;
  let isCloned = false;
  let sourceRevision = getString(payload?.data?.sourceRevision);

  if (
    payload?.data?.action === 'clone' ||
    (!payload?.data?.action && payload?.data?.repository)
  ) {
    if (payload?.data?.repository) {
      const repo = normalizeGitHubRepository(payload.data.repository);
      const branch = payload.data.branch || 'main';
      const token = payload?.github?.accessToken;

      await publishLog(`Cloning repository ${repo} on branch ${branch}...`);

      const cloneUrl = `https://github.com/${repo}.git`;
      const gitEnvironment = createGitCredentialEnvironment(token);

      try {
        fs.rmSync('/app/repo', { force: true, recursive: true });
        await new Promise<void>((resolve, reject) => {
          const gitArgs = sourceRevision
            ? [
                'clone',
                '--no-checkout',
                '--filter=blob:none',
                cloneUrl,
                '/app/repo',
              ]
            : [
                'clone',
                '--depth',
                '1',
                '-b',
                branch,
                '--single-branch',
                cloneUrl,
                '/app/repo',
              ];
          const gitProcess = spawn('git', gitArgs, { env: gitEnvironment });

          gitProcess.stdout.on('data', (data) =>
            console.log(`[Git]: ${data.toString().trim()}`),
          );
          gitProcess.stderr.on('data', (data) =>
            console.log(`[Git]: ${data.toString().trim()}`),
          );

          gitProcess.on('close', (code) => {
            if (code === 0) {
              resolve();
              return;
            }
            const message = `Git clone failed with code ${code}`;
            console.error(`[Git Error]: ${message}`);
            reject(new Error(message));
          });
        });
        if (sourceRevision) {
          await new Promise<void>((resolve, reject) => {
            const checkout = spawn(
              'git',
              [
                '-C',
                '/app/repo',
                'fetch',
                '--depth',
                '1',
                'origin',
                sourceRevision,
              ],
              { env: gitEnvironment, stdio: 'inherit' },
            );
            checkout.on('close', (code) =>
              code === 0
                ? resolve()
                : reject(
                    new Error(
                      `git fetch pinned revision failed with code ${code}`,
                    ),
                  ),
            );
          });
          await new Promise<void>((resolve, reject) => {
            const checkout = spawn(
              'git',
              ['-C', '/app/repo', 'checkout', '--detach', 'FETCH_HEAD'],
              { stdio: 'inherit' },
            );
            checkout.on('close', (code) =>
              code === 0
                ? resolve()
                : reject(
                    new Error(
                      `git checkout pinned revision failed with code ${code}`,
                    ),
                  ),
            );
          });
        }
        sourceRevision = await new Promise<string>((resolve, reject) => {
          const revision = spawn('git', [
            '-C',
            '/app/repo',
            'rev-parse',
            'HEAD',
          ]);
          const chunks: Buffer[] = [];
          revision.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
          revision.on('close', (code) =>
            code === 0
              ? resolve(Buffer.concat(chunks).toString('utf8').trim())
              : reject(new Error(`git rev-parse failed with code ${code}`)),
          );
        });
        await publishLog('Repository cloned successfully.');
        workingDir = resolveRepositoryWorkingDirectory(
          '/app/repo',
          payload?.data?.folder,
        );
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

  return {
    ...(sourceRevision ? { sourceRevision } : {}),
    testLanguage,
    workingDir,
  };
}

async function aggregateBlobReports(payload: any, workingDir: string) {
  const artifacts = validateBlobArtifacts(payload?.data?.blobArtifacts);
  const blobDirectory = path.join(workingDir, 'all-blob-reports');
  fs.mkdirSync(blobDirectory, { recursive: true });
  const cloudProvider = payload?.data?.cloudProvider || 'LOCAL_RUNNER';
  const bucketName = getString(payload?.data?.bucketName);
  const gcpProject = getString(payload?.settings?.gcp?.selectedProject);
  const accessToken = getString(payload?.settings?.gcp?.accessToken);
  const storage =
    cloudProvider === 'GCP' && bucketName && gcpProject && accessToken
      ? await createAuthenticatedStorage(gcpProject, accessToken)
      : null;

  for (const artifact of artifacts) {
    const destination = path.join(
      blobDirectory,
      `${artifact.shardIndex}-${path.basename(artifact.fileName)}`,
    );
    if (storage) {
      if (!artifact.objectPath) {
        throw new Error(`Shard ${artifact.shardIndex} has no GCS object path.`);
      }
      await storage
        .bucket(bucketName)
        .file(artifact.objectPath)
        .download({ destination });
    } else {
      const url = new URL(
        `/api/outputs/${payload.data.testId}/${artifact.runtimeNodeId}/blob-report/${encodeURIComponent(artifact.fileName)}`,
        requiredEditorApiUrl(payload?.data?.editorApiUrl),
      );
      const response = await fetch(url, {
        headers: {
          [EXECUTION_TOKEN_HEADER]: payload?.data?.executionAuthToken || '',
        },
      });
      if (!response.ok) {
        throw new Error(
          `Failed to download shard ${artifact.shardIndex} blob (${response.status}).`,
        );
      }
      fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
    }
    verifyBlobArtifact(artifact, destination);
  }

  const command = resolvePlaywrightCommand(workingDir);
  const args = [
    ...command.args.slice(0, -1),
    'merge-reports',
    '--reporter=html,json',
    blobDirectory,
  ];
  await publishLog(`Merging ${artifacts.length} Playwright blob reports...`);
  await new Promise<void>((resolve, reject) => {
    const mergeProcess = spawn(command.command, args, {
      cwd: workingDir,
      env: {
        ...repositoryProcessEnvironment(),
        PLAYWRIGHT_HTML_OPEN: 'never',
        PLAYWRIGHT_HTML_OUTPUT_DIR: path.join(workingDir, 'playwright-report'),
        PLAYWRIGHT_JSON_OUTPUT_FILE: path.join(
          workingDir,
          'playwright-report',
          'report.json',
        ),
      },
    });
    mergeProcess.stdout.on('data', (data) =>
      console.log(`[playwright merge]: ${data.toString().trim()}`),
    );
    mergeProcess.stderr.on('data', (data) =>
      console.error(`[playwright merge error]: ${data.toString().trim()}`),
    );
    mergeProcess.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Playwright report merge failed with code ${code}`)),
    );
  });
  return artifacts;
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
  const payload = await readPlaywrightPayload();
  selectedExecutionEnvironment = readPlaywrightExecutionEnvironment(payload);
  const testId = payload?.data?.testId || crypto.randomUUID();
  const cloudProvider = payload?.data?.cloudProvider || 'LOCAL_RUNNER';
  const executionMode = getString(payload?.data?.executionMode) || 'test';
  const runnerControl = payload?.data?.runnerControl as
    | RunnerControlConfig
    | undefined;
  runnerEventContext = {
    ...(executionMode === 'aggregate' ||
    executionMode === 'discovery' ||
    executionMode === 'shard'
      ? { childKind: executionMode }
      : {}),
    cloudProvider,
    editorApiUrl: requiredEditorApiUrl(payload?.data?.editorApiUrl),
    executionToken: payload?.data?.executionAuthToken || '',
    eventTransport: payload?.data?.eventTransport,
    gcpAccessToken: payload?.settings?.gcp?.accessToken,
    logicalNodeId: payload?.data?.logicalNodeId,
    nodeId: payload?.data?.nodeId,
    shardIndex: payload?.data?.shardIndex,
    shardTotal: payload?.data?.shardTotal,
    testId,
  };
  if (runnerControl) {
    const nodeId = getString(runnerEventContext.nodeId);
    if (!nodeId || !runnerEventContext.executionToken) {
      throw new Error('Playwright runner control context is incomplete.');
    }
    runnerControlClient = createRunnerControlClient({
      config: runnerControl,
      diagnosticLogs: runnerDiagnosticLogs,
      executionId: testId,
      gcpAccessToken: runnerEventContext.gcpAccessToken,
      logPrefix: '[Playwright Runner]',
      nodeId,
      runnerName: 'Playwright runner',
      workflowEventAttributes: { cloudProvider },
      workflowEventFields: {
        cloudProvider,
        ...(runnerEventContext.childKind
          ? { childKind: runnerEventContext.childKind }
          : {}),
        ...(runnerEventContext.logicalNodeId
          ? { parentNodeId: runnerEventContext.logicalNodeId }
          : {}),
        ...(runnerEventContext.shardIndex
          ? { shardIndex: runnerEventContext.shardIndex }
          : {}),
        ...(runnerEventContext.shardTotal
          ? { shardTotal: runnerEventContext.shardTotal }
          : {}),
      },
    });
  }

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
  await publishLog(`Start signal received. Running ${executionMode}.`);

  if (executionMode === 'discovery') {
    try {
      if (prepared.testLanguage !== 'typescript') {
        throw new Error(
          'Sharding is only supported by the TypeScript runtime.',
        );
      }
      const discovery = await discoverTypescriptTests(
        prepared.workingDir,
        prepared.sourceRevision,
      );
      await publishNodeState('success');
      await publishRunnerStatus(runnerControl, 'completed', undefined, {
        discovery,
      });
      process.exit(0);
    } catch (error: any) {
      await publishLog(`Playwright Discovery Error: ${error.message}`, 'error');
      await publishNodeState('error');
      await publishRunnerStatus(runnerControl, 'completed', error.message, {});
      process.exit(0);
    }
  }

  if (executionMode === 'aggregate') {
    try {
      const artifacts = await aggregateBlobReports(
        payload,
        prepared.workingDir,
      );
      const output = await uploadOutputs(
        prepared.workingDir,
        payload?.data?.outputNodeId || payload?.data?.logicalNodeId,
        testId,
        payload?.data?.editorApiUrl,
        payload?.data?.executionAuthToken,
        payload?.data?.bucketName,
        payload?.settings?.gcp?.accessToken,
        payload?.settings?.gcp?.selectedProject,
        cloudProvider,
      );
      const aggregateOutput = { ...output, shards: artifacts };
      await publishNodeState('success');
      await publishRunnerStatus(
        runnerControl,
        'completed',
        undefined,
        aggregateOutput,
      );
      process.exit(0);
    } catch (error: any) {
      await publishLog(
        `Playwright Aggregation Error: ${error.message}`,
        'error',
      );
      await publishNodeState('error');
      await publishRunnerStatus(runnerControl, 'completed', error.message, {});
      process.exit(0);
    }
  }

  const workers = normalizeWorkers(
    payload?.data?.workers || process.env.PLAYWRIGHT_WORKERS,
  );
  let testFailed = false;
  try {
    if (prepared.testLanguage === 'python') {
      await runPythonTest(prepared.workingDir);
    } else {
      await runTypescriptTest(
        prepared.workingDir,
        workers,
        executionMode === 'shard'
          ? {
              index: Number(payload?.data?.shardIndex),
              total: Number(payload?.data?.shardTotal),
            }
          : undefined,
      );
    }

    await publishLog('Job complete.');
  } catch (err: any) {
    testFailed = true;
    await publishLog(`Playwright Error: ${err.message}`, 'error');
  }

  let blobArtifact: PlaywrightBlobArtifact | undefined;
  if (executionMode === 'shard') {
    try {
      blobArtifact = createBlobArtifact({
        blobDirectory: path.join(prepared.workingDir, 'blob-report'),
        logicalNodeId: payload?.data?.logicalNodeId,
        playwrightVersion: payload?.data?.playwrightVersion,
        runtimeNodeId: payload?.data?.nodeId,
        shardIndex: Number(payload?.data?.shardIndex),
        shardTotal: Number(payload?.data?.shardTotal),
        sourceRevision: prepared.sourceRevision,
        testId,
      });
    } catch (error: any) {
      testFailed = true;
      await publishLog(`Blob Report Error: ${error.message}`, 'error');
    }
  }

  const output = await uploadOutputs(
    prepared.workingDir,
    payload?.data?.nodeId,
    testId,
    payload?.data?.editorApiUrl,
    payload?.data?.executionAuthToken,
    payload?.data?.bucketName,
    payload?.settings?.gcp?.accessToken,
    payload?.settings?.gcp?.selectedProject,
    cloudProvider,
    blobArtifact,
  );
  await publishNodeState(testFailed ? 'error' : 'success');
  await publishRunnerStatus(
    runnerControl,
    'completed',
    testFailed ? 'Playwright tests failed.' : undefined,
    output,
  );

  process.exit(0);
}

run();
