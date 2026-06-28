import { LOCAL_PUBSUB_PROJECT_ID, ORCHESTRATOR_URL } from '../config';
import { executionEvents } from '../services/execution-events';
import type { GcpPubSubEventStreamManager } from '@playrunner/gcp/api-runtime';
import type {
  LogTransport,
  WorkflowExecutionBackend,
  WorkflowExecutionRequest,
  WorkflowExecutionResult,
} from './contracts';
import { ensureLocalOrchestratorRunning } from './orchestrator-runner';

export class LocalWorkflowExecutionBackend implements WorkflowExecutionBackend {
  constructor(
    private readonly logTransport: LogTransport,
    private readonly pubSubEventStreamManager: GcpPubSubEventStreamManager,
  ) {}

  supports(cloudProvider: string): boolean {
    return cloudProvider === 'LOCAL_RUNNER';
  }

  async execute(
    request: WorkflowExecutionRequest,
  ): Promise<WorkflowExecutionResult> {
    const { body, testId } = request;
    const workflowId = body.workflowId;
    const userId = request.req.authUser?.providerUserId;

    if (!userId) {
      return {
        body: { error: 'Unauthorized' },
        status: 401,
      };
    }

    const runnerStart = await ensureLocalOrchestratorRunning();
    if (!runnerStart.ok) {
      return {
        body: { error: runnerStart.message },
        status: 502,
      };
    }

    const { executionToken } = await executionEvents.createExecution({
      cloudProvider: 'LOCAL_RUNNER',
      executionId: testId,
      userId,
      workflowId,
    });

    body.executionAuthToken = executionToken;

    let eventTransport:
      | {
          projectId: string;
          subscriptionName: string;
          topicName: string;
          type: 'gcp_pubsub';
        }
      | undefined;

    try {
      eventTransport =
        await this.pubSubEventStreamManager.ensureGcpPubSubEventStream({
          creds: { accessToken: '' },
          emulatorHost: process.env.PUBSUB_EMULATOR_HOST || null,
          executionId: testId,
          projectId: LOCAL_PUBSUB_PROJECT_ID,
        });
      body.eventTransport = eventTransport;
    } catch (err: any) {
      return {
        body: {
          error: `Failed to configure local Pub/Sub event transport: ${err.message}`,
          testId,
        },
        status: 500,
      };
    }

    try {
      const response = await fetch(`${ORCHESTRATOR_URL}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const details = await response.text().catch(() => '');
        if (eventTransport) {
          this.pubSubEventStreamManager.stopGcpPubSubEventStream(testId);
        }
        try {
          await this.logTransport.publish(
            JSON.stringify({
              cloudProvider: 'LOCAL_RUNNER',
              executionId: testId,
              level: 'error',
              message: `Runner failed to process workflow${details ? `: ${details}` : '.'}`,
              testId,
              timestamp: new Date().toISOString(),
              type: 'workflow_failed',
              workflowId,
            }),
          );
        } catch {
          // Ignore best-effort log transport failures.
        }

        return {
          body: { error: 'Runner failed to process workflow', testId },
          status: 500,
        };
      }

      return {
        body: {
          message: `Workflow triggered on local runner successfully, testId: ${testId}`,
          testId,
        },
        status: 200,
      };
    } catch (err: any) {
      if (eventTransport) {
        this.pubSubEventStreamManager.stopGcpPubSubEventStream(testId);
      }
      try {
        await this.logTransport.publish(
          JSON.stringify({
            executionId: testId,
            level: 'error',
            message: `Failed to communicate with runner: ${err.message}`,
            testId,
            timestamp: new Date().toISOString(),
            type: 'workflow_failed',
            workflowId,
          }),
        );
      } catch {
        // Ignore best-effort log transport failures.
      }

      return {
        body: {
          error: `Failed to communicate with runner: ${err.message}`,
          testId,
        },
        status: 500,
      };
    }
  }
}
