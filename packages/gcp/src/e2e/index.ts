import { definePlayrunnerE2EContribution } from '@playrunner/integration-sdk/e2e';
import { createGcpE2EData } from './data';
import { GcpE2EPom } from './GcpE2EPom';

export const gcpE2EContribution = definePlayrunnerE2EContribution({
  id: 'gcp',
  createData: createGcpE2EData,
  createPom: ({ host, page }) => new GcpE2EPom(page, host),
  scenarios: [
    {
      id: 'oauth-setup',
      mode: 'mock',
      title: 'validates the GCP OAuth provisioning wizard',
      tags: ['@gcp', '@integration'],
      async run({ data, expect, pom }) {
        await pom.open();

        await expect(pom.setupGuideLink).toHaveAttribute('target', '_blank');
        await expect(pom.clientSecretInput).toHaveAttribute('type', 'password');
        await expect(pom.authenticateButton).toBeDisabled();

        await pom.clientIdInput.click();
        await pom.clientIdInput.fill(data.clientId);
        await pom.clientSecretInput.click();
        await pom.clientSecretInput.fill(data.clientSecret);
        await expect(pom.authenticateButton).toBeEnabled();

        await pom.provisionStepButton.click();
        await expect(pom.provisioningGuideLink).toHaveAttribute(
          'target',
          '_blank',
        );
        await expect(pom.provisionButton).toBeDisabled();
        await expect(pom.dialog).toContainText(
          'Terraform is not required for cloud runners',
        );
      },
    },
  ],
});

export default gcpE2EContribution;

export { createGcpE2EData } from './data';
export type { GcpE2EData } from './data';
export { GcpE2EPom } from './GcpE2EPom';
