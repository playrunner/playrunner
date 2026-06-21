import {spawn} from 'child_process';
import {
  EDITOR_API_URL_DOCKER,
  GCP_PROJECT,
  ORCHESTRATOR_IMAGE,
  ORCHESTRATOR_PORT,
  ORCHESTRATOR_URL,
} from '../config';
import {state} from '../state';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function isOrchestratorHealthy(timeoutMs = 1500): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${ORCHESTRATOR_URL}/health`, {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForOrchestratorHealth(timeoutMs = 10000, pollIntervalMs = 250) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isOrchestratorHealthy()) {
      return true;
    }

    await sleep(pollIntervalMs);
  }

  return false;
}

export async function ensureLocalOrchestratorRunning(): Promise<{
  message: string;
  ok: boolean;
}> {
  if (await isOrchestratorHealthy()) {
    return {
      message: 'Runner is already running.',
      ok: true,
    };
  }

  if (state.runnerProcess) {
    const becameHealthy = await waitForOrchestratorHealth(5000);
    return becameHealthy
      ? {
          message: 'Runner is already running.',
          ok: true,
        }
      : {
          message: 'Runner process exists but did not become healthy.',
          ok: false,
        };
  }

  console.log('Starting orchestrator runner in a Docker container...');

  let spawnError: Error | null = null;
  const runnerProcess = spawn(
    'docker',
    [
      'run',
      '--rm',
      '-p',
      `${ORCHESTRATOR_PORT}:8080`,
      '-e',
      'PORT=8080',
      '-e',
      `ENABLE_PREMIUM=${process.env.ENABLE_PREMIUM ?? 'true'}`,
      '-e',
      `GCP_PROJECT=${GCP_PROJECT}`,
      '-e',
      `EDITOR_API_URL=${EDITOR_API_URL_DOCKER}`,
      '-v',
      '/var/run/docker.sock:/var/run/docker.sock',
      ORCHESTRATOR_IMAGE,
    ],
    {
      stdio: 'inherit',
    },
  );

  runnerProcess.on('error', (error) => {
    spawnError = error;
    console.error('Failed to start orchestrator Docker container:', error);
  });

  state.runnerProcess = runnerProcess;
  state.runnerProcess.on('exit', (code) => {
    console.log(`Orchestrator Docker container exited with code ${code}`);
    state.runnerProcess = null;
  });

  const becameHealthy = await waitForOrchestratorHealth();
  if (!becameHealthy) {
    return {
      message: spawnError?.message ?? 'Docker Orchestrator failed to become healthy.',
      ok: false,
    };
  }

  return {
    message: 'Docker Orchestrator started.',
    ok: true,
  };
}
