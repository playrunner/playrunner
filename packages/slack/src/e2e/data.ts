import type { PlayrunnerE2EDataContext } from '@playrunner/integration-sdk/e2e';

export interface SlackE2EData {
  webhookUrl: string;
}

export function createSlackE2EData({
  runId,
}: PlayrunnerE2EDataContext): SlackE2EData {
  const suffix = runId.replace(/[^a-zA-Z0-9]/g, '');
  return {
    webhookUrl: `https://hooks.slack.test/services/e2e/${suffix}`,
  };
}
