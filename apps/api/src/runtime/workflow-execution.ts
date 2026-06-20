import { ORCHESTRATOR_URL } from '../config';
import { state } from '../state';
import type { LogTransport, WorkflowExecutionBackend, WorkflowExecutionRequest, WorkflowExecutionResult } from './contracts';

export class LocalWorkflowExecutionBackend implements WorkflowExecutionBackend {
  constructor(private readonly logTransport: LogTransport) {}

  supports(cloudProvider: string): boolean {
    return cloudProvider === 'LOCAL-DEV';
  }

  async execute(request: WorkflowExecutionRequest): Promise<WorkflowExecutionResult> {
    const { body, testId } = request;
    const workflowId = body.workflowId;

    if (!state.runnerProcess) {
      return {
        body: { error: 'Runner is not running.' },
        status: 400,
      };
    }

    try {
      const response = await fetch(`${ORCHESTRATOR_URL}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        return {
          body: { error: 'Runner failed to process workflow' },
          status: 500,
        };
      }

      try {
        await this.logTransport.publish(JSON.stringify({
          type: 'workflow_started',
          testId,
          workflowId,
          cloudProvider: 'LOCAL-DEV',
          timestamp: new Date(),
        }));
      } catch {
        // Ignore best-effort log transport failures.
      }

      return {
        body: { message: `Workflow triggered on local runner successfully, testId: ${testId}` },
        status: 200,
      };
    } catch (err: any) {
      return {
        body: { error: `Failed to communicate with runner: ${err.message}` },
        status: 500,
      };
    }
  }
}
