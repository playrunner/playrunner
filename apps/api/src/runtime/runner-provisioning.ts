import type { RunnerProvisionResult, RunnerProvisioner } from './contracts';
import { ensureLocalOrchestratorRunning } from './orchestrator-runner';

export class LocalDockerRunnerProvisioner implements RunnerProvisioner {
  async start(cloudProvider = 'LOCAL_RUNNER'): Promise<RunnerProvisionResult> {
    if (cloudProvider !== 'LOCAL_RUNNER') {
      return {
        body: {
          message: `${cloudProvider} runner selected. Local Docker orchestrator startup skipped.`,
        },
        status: 200,
      };
    }

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
