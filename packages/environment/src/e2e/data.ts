import type { PlayrunnerE2EDataContext } from '@playrunner/integration-sdk/e2e';

export interface EnvironmentE2EData {
  environmentName: string;
  runId: string;
  variableName: string;
  variableCurrentValue: string;
  variableValue: string;
}

export function createEnvironmentE2EData({
  runId,
}: PlayrunnerE2EDataContext): EnvironmentE2EData {
  const suffix = runId.replace(/[^a-zA-Z0-9-]/g, '-');
  return {
    environmentName: 'Environment',
    runId,
    variableName: `PLAYRUNNER_E2E_${suffix}`.toUpperCase(),
    variableCurrentValue: `environment-current-${suffix}`,
    variableValue: `environment-value-${suffix}`,
  };
}
