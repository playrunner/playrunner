import type { PlayrunnerE2EDataContext } from '@playrunner/integration-sdk/e2e';
export function createTeamsE2EData({ runId }: PlayrunnerE2EDataContext) {
  return {
    tenantId: 'playrunner-e2e',
    clientId: `fake-${runId}`,
    clientSecret: `fake-secret-${runId}`,
    message: `E2E ${runId}: {{workflow.definition.name}} finished with {{workflow.run.status}}`,
  };
}
export type TeamsE2EData = ReturnType<typeof createTeamsE2EData>;
