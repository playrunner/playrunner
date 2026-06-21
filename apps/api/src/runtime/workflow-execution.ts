import { ORCHESTRATOR_URL } from '../config';
import { executionEvents } from '../services/execution-events';
import type {
  LogTransport,
  WorkflowExecutionBackend,
  WorkflowExecutionRequest,
  WorkflowExecutionResult,
} from './contracts';
import { ensureLocalOrchestratorRunning } from './orchestrator-runner';

export class LocalWorkflowExecutionBackend implements WorkflowExecutionBackend {
  constructor(private readonly logTransport: LogTransport) {}

  supports(cloudProvider: string): boolean {
    return cloudProvider === 'LOCAL-DEV';
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
      cloudProvider: 'LOCAL-DEV',
      executionId: testId,
      userId,
      workflowId,
    });

    body.executionAuthToken = executionToken;

    try {
      await this.logTransport.publish(
        JSON.stringify({
          cloudProvider: 'LOCAL-DEV',
          executionId: testId,
          level: 'info',
          message: 'Workflow execution requested.',
          testId,
          timestamp: new Date().toISOString(),
          type: 'workflow_started',
          workflowId,
        }),
      );

      const response = await fetch(`${ORCHESTRATOR_URL}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const details = await response.text().catch(() => '');
        try {
          await this.logTransport.publish(
            JSON.stringify({
              cloudProvider: 'LOCAL-DEV',
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

      try {
        await this.logTransport.publish(
          JSON.stringify({
            cloudProvider: 'LOCAL-DEV',
            executionId: testId,
            level: 'info',
            message: 'Local orchestrator triggered successfully.',
            testId,
            timestamp: new Date().toISOString(),
            type: 'log',
            workflowId,
          }),
        );
      } catch {
        // Ignore best-effort log transport failures.
      }

      return {
        body: {
          message: `Workflow triggered on local runner successfully, testId: ${testId}`,
          testId,
        },
        status: 200,
      };
    } catch (err: any) {
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
