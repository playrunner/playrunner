import type { PlayrunnerE2EDataContext } from '@playrunner/integration-sdk/e2e';

export interface ResendE2EData {
  apiKey: string;
  body: string;
  from: string;
  html: string;
  receivingAddress: string;
  recipientVariableName: string;
  subject: string;
  templateId: string;
  templateVariables: string;
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
    body: `Plain text ${suffix}`,
    from: `Playrunner <sender+${suffix}@example.test>`,
    html: `<p>HTML ${suffix}</p>`,
    receivingAddress: `login+${suffix}@example.resend.app`,
    recipientVariableName: `RESEND_RECIPIENT_${variableSuffix}`,
    subject: `Resend E2E ${suffix}`,
    templateId: `template-${suffix}`,
    templateVariables: `{"runId":"${suffix}"}`,
  };
}
