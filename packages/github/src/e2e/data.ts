import type { PlayrunnerE2EDataContext } from '@playrunner/integration-sdk/e2e';

export interface GithubE2EData {
  appName: string;
  issueBody: string;
  issueTitle: string;
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
    issueBody: `Created by the Playrunner ${mode} E2E suite (${suffix}).`,
    issueTitle: `[Playrunner E2E] ${suffix}`,
    clientId: `github-client-${suffix}`,
    clientSecret: `github-secret-${suffix}`,
    mode,
    repository:
      mode === 'live'
        ? (process.env.PLAYRUNNER_E2E_GITHUB_REPOSITORY ?? '')
        : 'playrunner/e2e-fixture',
  };
}
