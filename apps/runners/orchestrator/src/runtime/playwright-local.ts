import { spawn } from 'child_process';
import crypto from 'crypto';
import type {
  PlaywrightExecutionBackend,
  PlaywrightExecutionRequest,
  PreparedPlaywrightRunner,
} from './contracts';
import { createPubSubRunnerControl } from './pubsub-runner-control';

const PLAYWRIGHT_IMAGE_BASE =
  process.env.PLAYWRIGHT_IMAGE_BASE || 'playrunner-playwright-runner';

function resolvePlaywrightLocalImage(runtime: 'typescript' | 'python'): string {
  return `${PLAYWRIGHT_IMAGE_BASE}-${runtime}`;
}

function resolveExecutionId(request: PlaywrightExecutionRequest): string {
  return (
    request.reqBody.testId ||
    request.payloadData?.data?.testId ||
    crypto.randomUUID()
  );
}

function createContainerName(executionId: string, nodeId: string): string {
  return `playrunner-${executionId}-${nodeId}`
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '-')
    .slice(0, 120);
}

async function stopContainer(containerName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const stop = spawn('docker', ['stop', '--time', '5', containerName], {
      stdio: 'ignore',
    });
    stop.on('error', () => resolve(false));
    stop.on('exit', (code) => resolve(code === 0));
  });
}

export class LocalPlaywrightExecutionBackend implements PlaywrightExecutionBackend {
  supports(cloudProvider: string): boolean {
    return cloudProvider === 'LOCAL_RUNNER';
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
    const {
      config,
      envKeys,
      globalEnvVars,
      nodeId,
      payloadData,
      publishLog,
      registerActiveProcess,
      runtime,
    } = request;

    const imageTag = config.playwrightVersion || 'latest';
    const fullImage = `${resolvePlaywrightLocalImage(runtime)}:${imageTag}`;
    const executionId = resolveExecutionId(request);
    const containerName = createContainerName(executionId, nodeId);
    const eventTransport = request.reqBody.eventTransport as
      | { projectId?: string; topicName?: string; type?: 'gcp_pubsub' }
      | undefined;
    const accessToken = request.reqBody.settings?.gcp?.accessToken as
      string | undefined;

    if (
      eventTransport?.type !== 'gcp_pubsub' ||
      !eventTransport.projectId ||
      !eventTransport.topicName
    ) {
      throw new Error('Local Playwright runner requires Pub/Sub transport.');
    }

    const runnerControl = await createPubSubRunnerControl({
      accessToken,
      executionId,
      nodeId,
      projectId: eventTransport.projectId,
      topicName: eventTransport.topicName,
    });

    const preparedPayloadData = {
      ...payloadData,
      data: {
        ...(payloadData?.data || {}),
        runnerControl: runnerControl.payload,
      },
    };

    await publishLog(
      `Preparing Playwright Runner in Docker container using ${runtime} image: ${fullImage}`,
      'info',
    );

    const dockerArgs = [
      'run',
      '--rm',
      '--name',
      containerName,
      '--label',
      `playrunner.execution-id=${executionId}`,
      '--label',
      `playrunner.node-id=${nodeId}`,
      '--cpus',
      String(config.cpu || 2),
      '--memory',
      `${config.memory || 4}g`,
      '--platform',
      'linux/amd64',
    ];

    envKeys.forEach((key) => {
      const actualVal = globalEnvVars[key] || '***';
      dockerArgs.push('-e', `${key}=${actualVal}`);
    });

    if (process.env.PUBSUB_EMULATOR_HOST) {
      dockerArgs.push(
        '-e',
        `PUBSUB_EMULATOR_HOST=${process.env.PUBSUB_EMULATOR_HOST}`,
      );
    }
    dockerArgs.push('-e', `PAYLOAD=${JSON.stringify(preparedPayloadData)}`);
    dockerArgs.push(fullImage);

    const playwrightProcess = spawn('docker', dockerArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    registerActiveProcess(nodeId, playwrightProcess);
    const emitChunk = createChunkEmitter(async (line, level) => {
      if (line.startsWith('[Playwright Runner]')) {
        return;
      }
      await publishLog(`[Local Docker] ${line}`, level);
    });

    playwrightProcess.stdout?.on('data', (chunk) => {
      emitChunk(chunk.toString(), 'info');
    });

    playwrightProcess.stderr?.on('data', (chunk) => {
      emitChunk(chunk.toString(), 'info');
    });

    const completion = new Promise<void>((resolve, reject) => {
      playwrightProcess.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else if (code === null) {
          reject(new Error('Playwright Runner stopped by user'));
        } else {
          reject(new Error(`Playwright Runner exited with code ${code}`));
        }
      });
      playwrightProcess.on('error', (err) => {
        reject(err);
      });
    });

    let startRequested = false;
    let completed = false;
    let stopRequested = false;
    completion.then(
      () => {
        completed = true;
      },
      () => {
        completed = true;
      },
    );

    return {
      cancel: async () => {
        if (!completed && !stopRequested) {
          stopRequested = true;
          await runnerControl.publishCancel().catch((error) => {
            console.warn(
              `[Local] Failed to signal cancellation for Playwright runner ${nodeId}: ${error.message}`,
            );
          });
          if (!(await stopContainer(containerName))) {
            playwrightProcess.kill('SIGTERM');
          }
        }
      },
      cleanup: async () => {
        if (!startRequested && !completed) {
          await runnerControl.publishCancel().catch((error) => {
            console.warn(
              `[Local] Failed to cancel prepared Playwright runner ${nodeId}: ${error.message}`,
            );
          });
          if (!stopRequested) {
            stopRequested = true;
            if (!(await stopContainer(containerName))) {
              playwrightProcess.kill('SIGTERM');
            }
          }
          return;
        }
        await runnerControl.cleanup();
      },
      start: async () => {
        startRequested = true;
        await runnerControl.startWithRetry();
      },
      waitForCompletion: async () => {
        await completion;
        const result = await runnerControl.waitForCompletion();
        await publishLog('Playwright Runner finished and shut down.', 'info');
        return result;
      },
      waitUntilReady: async () => {
        await runnerControl.waitUntilReady();
      },
    };
  }
}

function createChunkEmitter(
  emit: (line: string, level: 'info' | 'error') => Promise<void>,
) {
  let buffered = '';

  return (chunk: string, level: 'info' | 'error') => {
    buffered += chunk;
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      void emit(trimmed, level);
    }
  };
}
