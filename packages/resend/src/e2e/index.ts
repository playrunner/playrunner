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
        await pom.apiKeyModeButton.click();
        await expect(pom.apiKeyInput).toHaveAttribute('type', 'password');
        await expect(pom.saveButton).toBeDisabled();

        await pom.apiKeyInput.fill(data.apiKey);
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
  ],
});

export default resendE2EContribution;

export { createResendE2EData } from './data';
export type { ResendE2EData } from './data';
export { ResendE2EPom } from './ResendE2EPom';
