import { selectExecutionEnvironment } from '../../../shared/execution-environment';
import { createPubSubRunnerControl } from './pubsub-runner-control';
import type {
  PlaywrightExecutionBackend,
  PlaywrightExecutionRequest,
  PreparedPlaywrightRunner,
} from './contracts';

export function deviceRunnerPayload(
  request: PlaywrightExecutionRequest,
  control: unknown,
) {
  // Only the selected test environment and repository credential leave Cloud.
  // Never forward GCP credentials, workflow settings or the execution ingest token.
  return {
    data: {
      ...request.payloadData.data,
      cloudProvider: 'LOCAL_RUNNER',
      executionAuthToken: '',
      environment: selectExecutionEnvironment(
        request.envKeys,
        request.globalEnvVars,
        'Playwright Environment',
      ),
      runnerControl: control,
    },
    ...(request.reqBody.localWorker.source === 'workspace'
      ? {}
      : { github: { accessToken: request.payloadData.github?.accessToken } }),
  };
}

export class DevicePlaywrightExecutionBackend implements PlaywrightExecutionBackend {
  supports(provider: string) {
    return provider === 'PAIRED_DEVICE';
  }

  async execute(request: PlaywrightExecutionRequest) {
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
    const { data } = request.payloadData;
    if (request.runtime !== 'typescript' || data.executionMode !== 'test') {
      throw new Error(
        'Local devices currently support TypeScript Playwright steps with sharding disabled.',
      );
    }
    const executionId = String(data.testId);
    const nodeId = request.nodeId;
    const base = new URL(data.editorApiUrl).origin;
    const control = await createPubSubRunnerControl({
      accessToken: request.reqBody.settings?.gcp?.accessToken,
      executionId,
      nodeId,
      onRunnerEvent: request.publishEvent,
      projectId: data.eventTransport.projectId,
      topicName: data.eventTransport.topicName,
    });
    const route = `${base}/api/local-workers/executions/${encodeURIComponent(executionId)}/nodes/${encodeURIComponent(nodeId)}`;
    const call = async (method: string, body?: unknown) => {
      const response = await fetch(route, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
        headers: {
          'content-type': 'application/json',
          'x-execution-token': data.executionAuthToken,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok)
        throw new Error(`Local worker request failed (${response.status}).`);
      return response.json() as Promise<{ status: string }>;
    };
    let stopped = false;
    let monitor: ReturnType<typeof setInterval> | undefined;
    let checking = false;
    let lastContact = Date.now();
    const unavailable = new Promise<never>((_resolve, reject) => {
      monitor = setInterval(() => {
        if (stopped || checking) return;
        checking = true;
        void call('GET')
          .then((job) => {
            lastContact = Date.now();
            if (['failed', 'cancelled', 'expired'].includes(job.status)) {
              reject(
                new Error(
                  `Local worker ${job.status}; hosted execution was not started.`,
                ),
              );
            }
          })
          .catch(() => {
            if (Date.now() - lastContact > 60_000)
              reject(
                new Error(
                  'Local worker status connection was lost. No hosted runner was started.',
                ),
              );
          })
          .finally(() => {
            checking = false;
          });
      }, 5_000);
    });
    // A failure can arrive between readiness and start; retain it without an
    // unhandled rejection until the next lifecycle operation observes it.
    void unavailable.catch(() => undefined);
    const cleanup = async () => {
      stopped = true;
      if (monitor) clearInterval(monitor);
      await call('DELETE').catch(() => undefined);
      await control.cleanup();
    };
    try {
      await call('POST', {
        localWorker: request.reqBody.localWorker,
        cpu: request.config.cpu,
        memory: request.config.memory,
        version: data.playwrightVersion,
        payload: deviceRunnerPayload(request, control.payload),
      });
      await request.publishLog(
        'Waiting for the selected local computer. Hosted browser compute is disabled.',
      );
      await request.publishEvent({
        type: 'log',
        level: 'info',
        nodeId,
        message: 'Execution target: local computer',
        executionTarget: 'local',
        deviceId: request.reqBody.localWorker.deviceId,
      });
    } catch (error) {
      await cleanup();
      throw error;
    }
    const watch = <T>(operation: Promise<T>) =>
      Promise.race([operation, unavailable]);
    return {
      waitUntilReady: () => watch(control.waitUntilReady()),
      start: () => watch(control.startWithRetry()),
      waitForCompletion: () => watch(control.waitForCompletion()),
      cancel: async () => {
        await control.publishCancel().catch(() => undefined);
        await call('DELETE');
      },
      cleanup,
    };
  }
}
