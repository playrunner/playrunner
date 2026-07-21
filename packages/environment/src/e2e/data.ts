import type { PlayrunnerE2EDataContext } from '@playrunner/integration-sdk/e2e';

export interface EnvironmentE2EData {
  runId: string;
}

export function createEnvironmentE2EData({
  runId,
}: PlayrunnerE2EDataContext): EnvironmentE2EData {
  return { runId };
}
