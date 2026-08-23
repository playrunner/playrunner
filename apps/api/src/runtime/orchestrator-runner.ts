import { execFile, spawn } from 'child_process';
import crypto from 'crypto';
import { promisify } from 'util';
import {
  EDITOR_API_URL_DOCKER,
  LOCAL_ORCHESTRATOR_IMAGE,
  ORCHESTRATOR_PORT,
  ORCHESTRATOR_URL,
  PUBSUB_EMULATOR_HOST_DOCKER,
} from '../config';
import { state } from '../state';

const execFileAsync = promisify(execFile);
const LOCAL_ORCHESTRATOR_CONTAINER_NAME = 'playrunner-orchestrator-local';
export const LOCAL_ORCHESTRATOR_AUTH_HEADER = 'x-playrunner-orchestrator-token';
const LOCAL_ORCHESTRATOR_AUTH_ENV = 'PLAYRUNNER_ORCHESTRATOR_AUTH_TOKEN';
const localOrchestratorAuthToken = crypto.randomBytes(32).toString('base64url');
const WORKFLOW_EVENTS_TOPIC =
  process.env.GCP_PUBSUB_WORKFLOW_EVENTS_TOPIC || 'playrunner-workflow-events';

interface OrchestratorRuntimeMetadata {
  eventTransport?: string;
  localAuth?: string;
  pubsubEmulatorHost?: string | null;
  runnerControl?: string;
  service?: string;
  workflowEventsTopic?: string;
}

export function getLocalOrchestratorRequestHeaders(): Record<string, string> {
  return { [LOCAL_ORCHESTRATOR_AUTH_HEADER]: localOrchestratorAuthToken };
}

export function createLocalOrchestratorDockerArgs(
  localDockerPlatform = process.env.PLAYRUNNER_LOCAL_DOCKER_PLATFORM?.trim(),
): string[] {
  if (
    localDockerPlatform &&
    !/^linux\/(?:amd64|arm64)$/.test(localDockerPlatform)
  ) {
    throw new Error(
      `Unsupported local Docker platform: ${localDockerPlatform}`,
    );
  }
  const args = [
    'run',
    '--rm',
    '--init',
    '--pids-limit',
    '512',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--ulimit',
    'nofile=4096:4096',
    '--add-host',
    'host.docker.internal:host-gateway',
    '--name',
    LOCAL_ORCHESTRATOR_CONTAINER_NAME,
    '--label',
    'playrunner.component=orchestrator',
    '--label',
    'playrunner.runner=local',
    '-p',
    `127.0.0.1:${ORCHESTRATOR_PORT}:8080`,
    '-e',
    'PORT=8080',
    '-e',
    `EDITOR_API_URL=${EDITOR_API_URL_DOCKER}`,
    '-e',
    `PUBSUB_EMULATOR_HOST=${PUBSUB_EMULATOR_HOST_DOCKER}`,
    '-e',
    `GCP_PUBSUB_WORKFLOW_EVENTS_TOPIC=${WORKFLOW_EVENTS_TOPIC}`,
    '-e',
    LOCAL_ORCHESTRATOR_AUTH_ENV,
    '-v',
    '/var/run/docker.sock:/var/run/docker.sock',
  ];
  if (localDockerPlatform) {
    args.push('-e', `PLAYRUNNER_LOCAL_DOCKER_PLATFORM=${localDockerPlatform}`);
  }
  args.push(LOCAL_ORCHESTRATOR_IMAGE);
  return args;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string, timeoutMs = 1500): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: getLocalOrchestratorRequestHeaders(),
      signal: controller.signal,
    });
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
      headers: getLocalOrchestratorRequestHeaders(),
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

export function isExpectedLocalOrchestrator(
  metadata: OrchestratorRuntimeMetadata | null,
): boolean {
  return (
    metadata?.service === 'playrunner-orchestrator' &&
    metadata.eventTransport === 'pubsub' &&
    metadata.localAuth === 'required' &&
    metadata.runnerControl === 'pubsub' &&
    metadata.pubsubEmulatorHost === PUBSUB_EMULATOR_HOST_DOCKER &&
    metadata.workflowEventsTopic === WORKFLOW_EVENTS_TOPIC
  );
}

async function rejectsInvalidLocalOrchestratorToken(
  timeoutMs = 1500,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${ORCHESTRATOR_URL}/runtime`, {
      headers: {
        [LOCAL_ORCHESTRATOR_AUTH_HEADER]: crypto
          .randomBytes(32)
          .toString('base64url'),
      },
      signal: controller.signal,
    });
    return response.status === 401;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function isExpectedLocalOrchestratorRunning(
  timeoutMs = 1500,
): Promise<boolean> {
  if (!(await isOrchestratorHealthy(timeoutMs))) return false;
  const metadata = await getOrchestratorRuntimeMetadata();
  if (!isExpectedLocalOrchestrator(metadata)) return false;
  return rejectsInvalidLocalOrchestratorToken(timeoutMs);
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
    if (await isExpectedLocalOrchestratorRunning()) {
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
    if (await isExpectedLocalOrchestratorRunning()) {
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
  const runnerProcess = spawn('docker', createLocalOrchestratorDockerArgs(), {
    env: {
      ...process.env,
      [LOCAL_ORCHESTRATOR_AUTH_ENV]: localOrchestratorAuthToken,
    },
    stdio: 'inherit',
  });

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
