import type { PlayrunnerE2EDataContext } from '@playrunner/integration-sdk/e2e';

export interface GithubE2EData {
  appName: string;
  clientId: string;
  clientSecret: string;
}

export function createGithubE2EData({
  runId,
}: PlayrunnerE2EDataContext): GithubE2EData {
  const suffix = runId.replace(/[^a-zA-Z0-9]/g, '-');
  return {
    appName: `playrunner-e2e-${suffix}`,
    clientId: `github-client-${suffix}`,
    clientSecret: `github-secret-${suffix}`,
  };
}
