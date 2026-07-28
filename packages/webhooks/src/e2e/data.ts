import type { PlayrunnerE2EDataContext } from '@playrunner/integration-sdk/e2e';

export interface WebhooksE2EData {
  bearerToken: string;
  publicUrl: string;
}

export function createWebhooksE2EData({
  runId,
}: PlayrunnerE2EDataContext): WebhooksE2EData {
  const normalizedRunId = runId.replace(/[^a-zA-Z0-9-]/g, '-');

  return {
    bearerToken: `webhook-e2e-${normalizedRunId}`,
    publicUrl: `https://${normalizedRunId}.example.test`,
  };
}
