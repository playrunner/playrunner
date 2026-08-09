import type { PlayrunnerE2EDataContext } from '@playrunner/integration-sdk/e2e';

export interface GithubE2EData {
  appName: string;
  assignees: string;
  issueBody: string;
  issueNumber: string;
  issueTitle: string;
  labels: string;
  clientId: string;
  clientSecret: string;
  mode: 'live' | 'mock';
  repository: string;
}

export function createGithubE2EData({
  mode,
  runId,
}: PlayrunnerE2EDataContext): GithubE2EData {
  const suffix = runId.replace(/[^a-zA-Z0-9]/g, '-');
  return {
    appName: `playrunner-e2e-${suffix}`,
    assignees: 'playrunner-bot',
    issueBody: `Created by the Playrunner ${mode} E2E suite (${suffix}).`,
    issueNumber: '42',
    issueTitle: `[Playrunner E2E] ${suffix}`,
    labels: 'e2e, automation',
    clientId: `github-client-${suffix}`,
    clientSecret: `github-secret-${suffix}`,
    mode,
    repository:
      mode === 'live'
        ? (process.env.PLAYRUNNER_E2E_GITHUB_REPOSITORY ?? '')
        : 'playrunner/e2e-fixture',
  };
}
