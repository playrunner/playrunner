import type { PlayrunnerE2EDataContext } from '@playrunner/integration-sdk/e2e';

export interface JiraE2EData {
  clientId: string;
  clientSecret: string;
  createDescription: string;
  createSummary: string;
  issueKey: string;
  issueType: string;
  projectId: string;
  updateDescription: string;
  updateSummary: string;
}

export function createJiraE2EData({
  runId,
}: PlayrunnerE2EDataContext): JiraE2EData {
  const suffix = runId.replace(/[^a-zA-Z0-9]/g, '-');
  return {
    clientId: `jira-client-${suffix}`,
    clientSecret: `jira-secret-${suffix}`,
    createDescription: `Jira create description ${suffix}`,
    createSummary: `Jira create summary ${suffix}`,
    issueKey: 'E2E-100',
    issueType: 'Bug',
    projectId: '10000',
    updateDescription: `Jira update description ${suffix}`,
    updateSummary: `Jira update summary ${suffix}`,
  };
}
