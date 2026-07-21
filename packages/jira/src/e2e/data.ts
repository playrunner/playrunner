import type { PlayrunnerE2EDataContext } from '@playrunner/integration-sdk/e2e';

export interface JiraE2EData {
  clientId: string;
  clientSecret: string;
}

export function createJiraE2EData({
  runId,
}: PlayrunnerE2EDataContext): JiraE2EData {
  const suffix = runId.replace(/[^a-zA-Z0-9]/g, '-');
  return {
    clientId: `jira-client-${suffix}`,
    clientSecret: `jira-secret-${suffix}`,
  };
}
