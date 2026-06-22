import { spawn } from 'child_process';
import type {
  PlaywrightExecutionBackend,
  PlaywrightExecutionRequest,
} from './contracts';

const GCP_PROJECT = process.env.GCP_PROJECT || 'local-dev';
const PLAYWRIGHT_IMAGE_BASE =
  process.env.PLAYWRIGHT_IMAGE_BASE || 'playrunner-playwright-runner';

function resolvePlaywrightLocalImage(runtime: 'typescript' | 'python'): string {
  return `${PLAYWRIGHT_IMAGE_BASE}-${runtime}`;
}

export class LocalPlaywrightExecutionBackend implements PlaywrightExecutionBackend {
  supports(cloudProvider: string): boolean {
    return cloudProvider === 'LOCAL_RUNNER';
  }

  async execute(request: PlaywrightExecutionRequest): Promise<void> {
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
    await publishLog(
      `Playwright Runner starting in Docker container using ${runtime} image: ${fullImage}`,
      'info',
    );

    const dockerArgs = ['run', '--rm', '--platform', 'linux/amd64'];
    dockerArgs.push('-e', `GCP_PROJECT=${GCP_PROJECT}`);

    envKeys.forEach((key) => {
      const actualVal = globalEnvVars[key] || '***';
      dockerArgs.push('-e', `${key}=${actualVal}`);
    });

    dockerArgs.push('-e', `PAYLOAD=${JSON.stringify(payloadData)}`);
    dockerArgs.push(fullImage);

    await new Promise<void>((resolve, reject) => {
      const playwrightProcess = spawn('docker', dockerArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      registerActiveProcess(nodeId, playwrightProcess);
      const emitChunk = createChunkEmitter(async (line, level) => {
        await publishLog(`[Local Docker] ${line}`, level);
      });

      playwrightProcess.stdout?.on('data', (chunk) => {
        emitChunk(chunk.toString(), 'info');
      });

      playwrightProcess.stderr?.on('data', (chunk) => {
        emitChunk(chunk.toString(), 'error');
      });

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

    await publishLog('Playwright Runner finished and shut down.', 'info');
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
