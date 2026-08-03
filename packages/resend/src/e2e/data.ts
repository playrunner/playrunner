import type { PlayrunnerE2EDataContext } from '@playrunner/integration-sdk/e2e';

export interface ResendE2EData {
  apiKey: string;
  receivingAddress: string;
}

export function createResendE2EData({
  runId,
}: PlayrunnerE2EDataContext): ResendE2EData {
  const suffix = runId.replace(/[^a-zA-Z0-9-]/g, '-');
  return {
    apiKey: `re_e2e_${suffix}`,
    receivingAddress: `login+${suffix}@example.resend.app`,
  };
}
