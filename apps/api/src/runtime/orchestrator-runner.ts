import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import {
  EDITOR_API_URL_DOCKER,
  ORCHESTRATOR_IMAGE,
  ORCHESTRATOR_PORT,
  ORCHESTRATOR_URL,
  PUBSUB_EMULATOR_HOST_DOCKER,
} from '../config';
import { state } from '../state';

const execFileAsync = promisify(execFile);
const LOCAL_ORCHESTRATOR_CONTAINER_NAME = 'playrunner-orchestrator-local';
const WORKFLOW_EVENTS_TOPIC =
  process.env.GCP_PUBSUB_WORKFLOW_EVENTS_TOPIC || 'playrunner-workflow-events';

interface OrchestratorRuntimeMetadata {
  eventTransport?: string;
  pubsubEmulatorHost?: string | null;
  runnerControl?: string;
  service?: string;
  workflowEventsTopic?: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string, timeoutMs = 1500): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function isOrchestratorHealthy(
  timeoutMs = 1500,
): Promise<boolean> {
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

async function getOrchestratorRuntimeMetadata(): Promise<OrchestratorRuntimeMetadata | null> {
  return fetchJson<OrchestratorRuntimeMetadata>(`${ORCHESTRATOR_URL}/runtime`);
}

function isExpectedLocalOrchestrator(
  metadata: OrchestratorRuntimeMetadata | null,
): boolean {
  return (
    metadata?.service === 'playrunner-orchestrator' &&
    metadata.eventTransport === 'pubsub' &&
    metadata.runnerControl === 'pubsub' &&
    metadata.pubsubEmulatorHost === PUBSUB_EMULATOR_HOST_DOCKER &&
    metadata.workflowEventsTopic === WORKFLOW_EVENTS_TOPIC
  );
}

async function stopContainersPublishingOrchestratorPort() {
  const { stdout } = await execFileAsync('docker', [
    'ps',
    '--filter',
    `publish=${ORCHESTRATOR_PORT}`,
    '--format',
    '{{.ID}}',
  ]);
  const containerIds = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const containerId of containerIds) {
    try {
      await execFileAsync('docker', ['stop', containerId]);
    } catch (error) {
      console.warn(
        `Failed to stop stale orchestrator container ${containerId}:`,
        error,
      );
    }
  }
}

async function removeNamedLocalOrchestratorContainer() {
  try {
    await execFileAsync('docker', [
      'rm',
      '-f',
      LOCAL_ORCHESTRATOR_CONTAINER_NAME,
    ]);
  } catch {
    // It is normal for the named container not to exist.
  }
}

async function waitForExpectedOrchestrator(
  timeoutMs = 10000,
  pollIntervalMs = 250,
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (
      (await isOrchestratorHealthy()) &&
      isExpectedLocalOrchestrator(await getOrchestratorRuntimeMetadata())
    ) {
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
    if (isExpectedLocalOrchestrator(await getOrchestratorRuntimeMetadata())) {
      return {
        message: 'Runner is already running with local Pub/Sub messaging.',
        ok: true,
      };
    }

    console.log(
      'Existing orchestrator runner is stale or missing Pub/Sub runtime metadata. Restarting it...',
    );
    await stopContainersPublishingOrchestratorPort();
    state.runnerProcess = null;
  }

  if (state.runnerProcess) {
    const becameHealthy = await waitForExpectedOrchestrator(5000);
    return becameHealthy
      ? {
          message: 'Runner is already running with local Pub/Sub messaging.',
          ok: true,
        }
      : {
          message:
            'Runner process exists but did not become healthy with local Pub/Sub messaging.',
          ok: false,
        };
  }

  await removeNamedLocalOrchestratorContainer();

  console.log('Starting orchestrator runner in a Docker container...');

  let spawnError: Error | null = null;
  const runnerProcess = spawn(
    'docker',
    [
      'run',
      '--rm',
      '--name',
      LOCAL_ORCHESTRATOR_CONTAINER_NAME,
      '--label',
      'playrunner.component=orchestrator',
      '--label',
      'playrunner.runner=local',
      '-p',
      `${ORCHESTRATOR_PORT}:8080`,
      '-e',
      'PORT=8080',
      '-e',
      `ENABLE_PREMIUM=${process.env.ENABLE_PREMIUM ?? 'true'}`,
      '-e',
      `EDITOR_API_URL=${EDITOR_API_URL_DOCKER}`,
      '-e',
      `PUBSUB_EMULATOR_HOST=${PUBSUB_EMULATOR_HOST_DOCKER}`,
      '-e',
      `GCP_PUBSUB_WORKFLOW_EVENTS_TOPIC=${WORKFLOW_EVENTS_TOPIC}`,
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

  const becameHealthy = await waitForExpectedOrchestrator();
  if (!becameHealthy) {
    return {
      message:
        spawnError?.message ??
        'Docker Orchestrator failed to become healthy with local Pub/Sub messaging.',
      ok: false,
    };
  }

  return {
    message: 'Docker Orchestrator started with local Pub/Sub messaging.',
    ok: true,
  };
}
