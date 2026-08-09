import { definePlayrunnerE2EContribution } from '@playrunner/integration-sdk/e2e';
import { createHuggingFaceE2EData } from './data';
import { HuggingFaceE2EPom } from './HuggingFaceE2EPom';

export const huggingFaceE2EContribution = definePlayrunnerE2EContribution({
  id: 'huggingface',
  createData: createHuggingFaceE2EData,
  createPom: ({ host, page }) => new HuggingFaceE2EPom(page, host),
  scenarios: [
    {
      id: 'manage-access-token',
      mode: 'mock',
      title: 'persists and removes a Hugging Face access token',
      tags: ['@huggingface', '@integration'],
      async run({ data, expect, pom }) {
        await pom.open();

        await expect(pom.setupGuideLink).toHaveAttribute('target', '_blank');
        await expect(pom.accessTokenInput).toHaveAttribute('type', 'password');
        await expect(pom.saveButton).toBeDisabled();

        await pom.accessTokenInput.click();
        await pom.accessTokenInput.fill(data.accessToken);
        await expect(pom.saveButton).toBeEnabled();
        await pom.saveButton.click();
        await expect(pom.connectedHeading).toBeVisible();

        await pom.close();
        await pom.reloadAndOpen();
        await expect(pom.connectedHeading).toBeVisible();

        await pom.disconnectButton.click();
        await expect(pom.accessTokenInput).toBeVisible();
        await pom.close();
        await pom.page.reload();
        await expect(
          pom.integrationCard().getByRole('button', { name: 'Connect' }),
        ).toBeVisible();
      },
    },
    {
      id: 'configure-all-node-values',
      mode: 'mock',
      title: 'configures and persists every Hugging Face node value',
      tags: ['@huggingface', '@integration', '@node'],
      async run({ data, expect, pom }) {
        await pom.createNode();
        await pom.nodeTask.selectOption('text-classification');
        await pom.nodeProvider.selectOption('hf-inference');
        await pom.nodeModel.fill(data.model);
        await pom.nodeInput.fill(data.input);
        await pom.nodeParameters.fill(data.parameters);
        await pom.saveReloadAndReopenNode();

        await expect(pom.nodeTask).toHaveValue('text-classification');
        await expect(pom.nodeProvider).toHaveValue('hf-inference');
        await expect(pom.nodeModel).toHaveValue(data.model);
        await expect(pom.nodeInput).toHaveValue(data.input);
        await expect(pom.nodeParameters).toHaveValue(data.parameters);
      },
    },
  ],
});

export default huggingFaceE2EContribution;

export { createHuggingFaceE2EData } from './data';
export type { HuggingFaceE2EData } from './data';
export { HuggingFaceE2EPom } from './HuggingFaceE2EPom';
