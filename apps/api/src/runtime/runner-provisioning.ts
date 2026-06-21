import type { RunnerProvisionResult, RunnerProvisioner } from './contracts';
import { ensureLocalOrchestratorRunning } from './orchestrator-runner';

export class LocalDockerRunnerProvisioner implements RunnerProvisioner {
  async start(): Promise<RunnerProvisionResult> {
    const result = await ensureLocalOrchestratorRunning();

    if (result.ok) {
      return {
        body: { message: result.message },
        status: 200,
      };
    }

    return {
      body: { error: result.message },
      status: 502,
    };
  }
}
