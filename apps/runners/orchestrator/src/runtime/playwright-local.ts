import crypto from 'crypto';
import { selectExecutionEnvironment } from '../../../shared/execution-environment';
import type {
  PlaywrightExecutionBackend,
  PlaywrightExecutionRequest,
  PlaywrightExecutionResult,
  PreparedPlaywrightRunner,
} from './contracts';
import { createPubSubRunnerControl } from './pubsub-runner-control';
import {
  createLocalContainerName,
  prepareLocalDockerRunner,
  resolveDockerPubSubEmulatorHost,
} from './docker-local';

const PLAYWRIGHT_IMAGE_BASE =
  process.env.PLAYWRIGHT_IMAGE_BASE || 'playrunner-playwright-runner';
const MAX_LOCAL_PLAYWRIGHT_PAYLOAD_BYTES = 10 * 1024 * 1024;

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

export function createLocalPlaywrightDockerArgs(args: {
  containerName: string;
  cpu: unknown;
  executionId: string;
  image: string;
  memory: unknown;
  nodeId: string;
  pubSubEmulatorHost?: string;
}): string[] {
  const dockerArgs = [
    'run',
    '-i',
    '--init',
    '--rm',
    '--pids-limit',
    '512',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--ulimit',
    'nofile=4096:4096',
    '--user',
    'pwuser',
    '--name',
    args.containerName,
    '--label',
    `playrunner.execution-id=${args.executionId}`,
    '--label',
    `playrunner.node-id=${args.nodeId}`,
    '--cpus',
    String(Number(args.cpu) || 2),
    '--memory',
    `${Number(args.memory) || 4}g`,
    '--shm-size',
    '1g',
    '--platform',
    'linux/amd64',
    '--add-host',
    'host.docker.internal:host-gateway',
  ];
  const emulatorHost = resolveDockerPubSubEmulatorHost(args.pubSubEmulatorHost);
  if (emulatorHost) {
    dockerArgs.push('-e', `PUBSUB_EMULATOR_HOST=${emulatorHost}`);
  }
  dockerArgs.push(args.image);
  return dockerArgs;
}

export class LocalPlaywrightExecutionBackend implements PlaywrightExecutionBackend {
  supports(cloudProvider: string): boolean {
    return cloudProvider === 'LOCAL_RUNNER';
  }

  async execute(request: PlaywrightExecutionRequest): Promise<void> {
    const runner = await this.prepare(request);
    try {
      await runner.waitUntilReady();
      await runner.start();
      await runner.waitForCompletion();
    } finally {
      await runner.cleanup?.();
    }
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
    const containerName = createLocalContainerName(
      'playrunner',
      executionId,
      nodeId,
    );
    const eventTransport = request.reqBody.eventTransport as
      | { projectId?: string; topicName?: string; type?: 'gcp_pubsub' }
      | undefined;
    const accessToken = request.reqBody.settings?.gcp?.accessToken as
      string | undefined;
    const executionAuthToken = String(
      payloadData?.data?.executionAuthToken || '',
    ).trim();

    if (
      eventTransport?.type !== 'gcp_pubsub' ||
      !eventTransport.projectId ||
      !eventTransport.topicName
    ) {
      throw new Error('Local Playwright runner requires Pub/Sub transport.');
    }
    if (!executionAuthToken) {
      throw new Error(
        'Local Playwright runner requires an executionAuthToken.',
      );
    }
    const selectedEnvironment = selectExecutionEnvironment(
      envKeys,
      globalEnvVars,
      'Playwright Environment',
    );

    const runnerControl = await createPubSubRunnerControl({
      accessToken,
      executionId,
      nodeId,
      onRunnerEvent: request.publishEvent,
      projectId: eventTransport.projectId,
      topicName: eventTransport.topicName,
    });

    const preparedPayloadData = {
      ...payloadData,
      data: {
        ...(payloadData?.data || {}),
        environment: selectedEnvironment,
        runnerControl: runnerControl.payload,
      },
    };
    let serializedPayload: string;
    try {
      serializedPayload = JSON.stringify(preparedPayloadData);
    } catch {
      await runnerControl.cleanup();
      throw new Error(
        'Local Playwright runner payload could not be serialized.',
      );
    }
    const payloadBytes = Buffer.byteLength(serializedPayload, 'utf8');
    if (payloadBytes > MAX_LOCAL_PLAYWRIGHT_PAYLOAD_BYTES) {
      await runnerControl.cleanup();
      throw new Error(
        `Local Playwright runner payload is ${payloadBytes} bytes; maximum is ${MAX_LOCAL_PLAYWRIGHT_PAYLOAD_BYTES} bytes.`,
      );
    }

    const dockerArgs = createLocalPlaywrightDockerArgs({
      containerName,
      cpu: config.cpu,
      executionId,
      image: fullImage,
      memory: config.memory,
      nodeId,
      pubSubEmulatorHost: process.env.PUBSUB_EMULATOR_HOST,
    });

    let runner: PreparedPlaywrightRunner;
    try {
      await publishLog(
        `Preparing Playwright Runner in Docker container using ${runtime} image: ${fullImage}`,
        'info',
      );
      runner = await prepareLocalDockerRunner<PlaywrightExecutionResult>({
        args: dockerArgs,
        containerName,
        control: runnerControl,
        input: serializedPayload,
        label: `Playwright Runner ${nodeId}`,
        nodeId,
        publishLog,
        registerActiveProcess,
        shouldPublishLine: (line) => !line.startsWith('[Playwright Runner]'),
        stderrLevel: 'info',
      });
    } catch (error) {
      await runnerControl.cleanup();
      throw error;
    }

    return {
      ...runner,
      waitForCompletion: async () => {
        const result = await runner.waitForCompletion();
        await publishLog('Playwright Runner finished and shut down.', 'info');
        return result;
      },
    };
  }
}
