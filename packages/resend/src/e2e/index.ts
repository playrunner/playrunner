import { definePlayrunnerE2EContribution } from '@playrunner/integration-sdk/e2e';
import { createResendE2EData } from './data';
import { ResendE2EPom } from './ResendE2EPom';

export const resendE2EContribution = definePlayrunnerE2EContribution({
  id: 'resend',
  createData: createResendE2EData,
  createPom: ({ host, page }) => new ResendE2EPom(page, host),
  scenarios: [
    {
      id: 'manage-api-key',
      mode: 'mock',
      title: 'connects, reloads, and disconnects a Resend API key',
      tags: ['@resend', '@integration'],
      async run({ data, expect, pom }) {
        await pom.open();
        await expect(pom.setupGuideLink).toHaveAttribute('target', '_blank');
        await expect(pom.setupGuideLink).toHaveAttribute(
          'href',
          /\/docs\/integration-packages\/resend#setup$/,
        );
        await expect(pom.connectModeButton).toHaveAttribute(
          'aria-pressed',
          'true',
        );
        await expect(pom.apiKeyModeButton).toHaveAttribute(
          'aria-pressed',
          'false',
        );
        await pom.apiKeyModeButton.click();
        await expect(pom.apiKeyModeButton).toHaveAttribute(
          'aria-pressed',
          'true',
        );
        await expect(pom.apiKeyInput).toHaveAttribute('type', 'password');
        await expect(pom.saveButton).toBeDisabled();

        await pom.apiKeyInput.click();
        await pom.apiKeyInput.fill(data.apiKey);
        await pom.receivingAddressInput.click();
        await pom.receivingAddressInput.fill(data.receivingAddress);
        await expect(pom.saveButton).toBeEnabled();
        await pom.saveButton.click();
        await expect(pom.connectedHeading).toBeVisible();

        await pom.close();
        await pom.reloadAndOpen();
        await expect(pom.connectedHeading).toBeVisible();
        await pom.disconnectButton.click();
        await expect(pom.apiKeyModeButton).toBeVisible();
        await pom.close();
        await pom.page.reload();
        await expect(
          pom.integrationCard().getByRole('button', { name: 'Connect' }),
        ).toBeVisible();
      },
    },
    {
      id: 'drop-environment-variable-into-recipient',
      mode: 'mock',
      title: 'templates a dropped environment variable in the recipient field',
      tags: ['@resend', '@integration', '@node'],
      async run({ data, expect, pom }) {
        await pom.createNodeWithEnvironmentVariable(
          data.recipientVariableName,
          data.receivingAddress,
        );
        await expect(pom.nodeDialog).toBeVisible();

        await pom.dragEnvironmentVariableToRecipient(
          data.recipientVariableName,
        );
        const template = `{{env.${data.recipientVariableName}}}`;
        await expect(pom.recipientTextarea).toHaveValue(template);

        await pom.closeNodeSettings();
        await pom.saveAndReloadWorkflow();
        await pom.reopenNodeSettings();
        await expect(pom.recipientTextarea).toHaveValue(template);
      },
    },
    {
      id: 'configure-all-node-values',
      mode: 'mock',
      title: 'configures and persists every Resend node value',
      tags: ['@resend', '@integration', '@node'],
      async run({ data, expect, pom }) {
        await pom.createNode();
        await pom.nodeField('operation').selectOption('send');
        await pom.nodeField('from').fill(data.from);
        await pom.nodeField('to').fill(data.receivingAddress);
        await pom.nodeField('subject').fill(data.subject);
        await pom.nodeField('content-mode').selectOption('body');
        await pom.nodeField('text').fill(data.body);
        await pom.nodeField('html').fill(data.html);
        await pom.advancedOptions.click();
        await pom.nodeField('cc').fill('cc@example.test');
        await pom.nodeField('bcc').fill('bcc@example.test');
        await pom.nodeField('reply-to').fill('reply@example.test');
        await pom.nodeField('idempotency-key').fill(`id-${data.subject}`);
        await pom.nodeField('tags').fill('{"suite":"e2e"}');
        await pom.nodeField('headers').fill('{"X-E2E":"true"}');
        await pom.nodeField('content-mode').selectOption('template');
        await pom.nodeField('template-id').fill(data.templateId);
        await pom.nodeField('template-variables').fill(data.templateVariables);

        await pom.nodeField('operation').selectOption('wait');
        await pom.nodeField('wait-recipient').fill(data.receivingAddress);
        await pom.nodeField('timeout').fill('180');
        await pom.nodeField('lookback').fill('45');
        await pom.nodeField('sender-filter').fill('@example.test');
        await pom.nodeField('subject-filter').fill('verification');
        await pom.nodeField('body-filter').fill('sign in');
        await pom.nodeField('extraction').selectOption('custom');
        await pom.nodeField('extraction-pattern').fill('code: ([0-9]{6})');
        await pom.nodeField('capture-group').fill('1');
        await pom.nodeField('attachments').selectOption('none');
        await pom.closeNodeSettings();
        await pom.saveAndReloadWorkflow();
        await pom.reopenNodeSettings();

        await expect(pom.nodeField('operation')).toHaveValue('wait');
        await expect(pom.nodeField('wait-recipient')).toHaveValue(
          data.receivingAddress,
        );
        await expect(pom.nodeField('timeout')).toHaveValue('180');
        await expect(pom.nodeField('lookback')).toHaveValue('45');
        await expect(pom.nodeField('sender-filter')).toHaveValue(
          '@example.test',
        );
        await expect(pom.nodeField('subject-filter')).toHaveValue(
          'verification',
        );
        await expect(pom.nodeField('body-filter')).toHaveValue('sign in');
        await expect(pom.nodeField('extraction')).toHaveValue('custom');
        await expect(pom.nodeField('extraction-pattern')).toHaveValue(
          'code: ([0-9]{6})',
        );
        await expect(pom.nodeField('capture-group')).toHaveValue('1');
        await expect(pom.nodeField('attachments')).toHaveValue('none');

        await pom.nodeField('operation').selectOption('send');
        await expect(pom.nodeField('from')).toHaveValue(data.from);
        await expect(pom.nodeField('to')).toHaveValue(data.receivingAddress);
        await expect(pom.nodeField('subject')).toHaveValue(data.subject);
        await expect(pom.nodeField('content-mode')).toHaveValue('template');
        await expect(pom.nodeField('template-id')).toHaveValue(data.templateId);
        await expect(pom.nodeField('template-variables')).toHaveValue(
          data.templateVariables,
        );
        await pom.advancedOptions.click();
        await expect(pom.nodeField('cc')).toHaveValue('cc@example.test');
        await expect(pom.nodeField('bcc')).toHaveValue('bcc@example.test');
        await expect(pom.nodeField('reply-to')).toHaveValue(
          'reply@example.test',
        );
        await expect(pom.nodeField('idempotency-key')).toHaveValue(
          `id-${data.subject}`,
        );
        await expect(pom.nodeField('tags')).toHaveValue('{"suite":"e2e"}');
        await expect(pom.nodeField('headers')).toHaveValue('{"X-E2E":"true"}');
        await pom.nodeField('content-mode').selectOption('body');
        await expect(pom.nodeField('text')).toHaveValue(data.body);
        await expect(pom.nodeField('html')).toHaveValue(data.html);
      },
    },
  ],
});

export default resendE2EContribution;

export { createResendE2EData } from './data';
export type { ResendE2EData } from './data';
export { ResendE2EPom } from './ResendE2EPom';
