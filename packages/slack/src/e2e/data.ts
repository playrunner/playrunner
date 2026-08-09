import type { PlayrunnerE2EDataContext } from '@playrunner/integration-sdk/e2e';

export interface SlackE2EData {
  message: string;
  username: string;
  webhookUrl: string;
}

export function createSlackE2EData({
  runId,
}: PlayrunnerE2EDataContext): SlackE2EData {
  const suffix = runId.replace(/[^a-zA-Z0-9]/g, '');
  return {
    message: `Workflow E2E ${suffix} finished`,
    username: `Playrunner E2E ${suffix.slice(-12)}`,
    webhookUrl: `https://hooks.slack.test/services/e2e/${suffix}`,
  };
}
