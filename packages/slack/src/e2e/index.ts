import { definePlayrunnerE2EContribution } from '@playrunner/integration-sdk/e2e';
import { createSlackE2EData } from './data';
import { SlackE2EPom } from './SlackE2EPom';

export const slackE2EContribution = definePlayrunnerE2EContribution({
  id: 'slack',
  createData: createSlackE2EData,
  createPom: ({ host, page }) => new SlackE2EPom(page, host),
  scenarios: [
    {
      id: 'manage-webhook',
      mode: 'mock',
      title: 'persists and removes a Slack webhook connection',
      tags: ['@slack', '@integration'],
      async run({ data, expect, pom }) {
        await pom.open();
        await expect(pom.setupGuideLink).toHaveAttribute('target', '_blank');
        await pom.selectWebhookMode();

        await expect(pom.webhookUrlInput).toHaveAttribute('type', 'password');
        await expect(pom.saveButton).toBeDisabled();
        await pom.webhookUrlInput.fill(data.webhookUrl);
        await expect(pom.saveButton).toBeEnabled();
        await pom.saveButton.click();
        await expect(pom.connectedHeading).toBeVisible();

        await pom.close();
        await pom.reloadAndOpen();
        await expect(pom.connectedHeading).toBeVisible();

        await pom.disconnectButton.click();
        await expect(pom.webhookModeButton).toBeVisible();
        await pom.close();
        await pom.page.reload();
        await expect(
          pom.integrationCard().getByRole('button', { name: 'Connect' }),
        ).toBeVisible();
      },
    },
  ],
});

export default slackE2EContribution;

export { createSlackE2EData } from './data';
export type { SlackE2EData } from './data';
export { SlackE2EPom } from './SlackE2EPom';
