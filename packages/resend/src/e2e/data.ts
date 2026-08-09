import type { PlayrunnerE2EDataContext } from '@playrunner/integration-sdk/e2e';

export interface ResendE2EData {
  apiKey: string;
  receivingAddress: string;
  recipientVariableName: string;
}

export function createResendE2EData({
  runId,
}: PlayrunnerE2EDataContext): ResendE2EData {
  const suffix = runId.replace(/[^a-zA-Z0-9-]/g, '-');
  const variableSuffix = runId
    .replace(/[^a-zA-Z0-9]/g, '_')
    .toUpperCase()
    .slice(-32);
  return {
    apiKey: `re_e2e_${suffix}`,
    receivingAddress: `login+${suffix}@example.resend.app`,
    recipientVariableName: `RESEND_RECIPIENT_${variableSuffix}`,
  };
}
