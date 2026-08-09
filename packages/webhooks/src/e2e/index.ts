import { definePlayrunnerE2EContribution } from '@playrunner/integration-sdk/e2e';
import { createWebhooksE2EData } from './data';
import { WebhooksE2EPom } from './WebhooksE2EPom';

export const webhooksE2EContribution = definePlayrunnerE2EContribution({
  id: 'webhooks',
  createData: createWebhooksE2EData,
  createPom: ({ host, page }) => new WebhooksE2EPom(page, host),
  scenarios: [
    {
      id: 'save-settings',
      mode: 'mock',
      title: 'saves and reloads webhook settings',
      tags: ['@webhooks', '@integration'],
      async run({ data, expect, pom }) {
        await pom.open();

        await expect(pom.dialog).toBeVisible();
        await expect(pom.bearerTokenInput).toHaveAttribute('type', 'password');
        await pom.exposureSelect.selectOption('public-url');
        await pom.enterPublicUrl(data.publicUrl);
        await pom.enterBearerToken(data.bearerToken);
        await pom.saveButton.click();

        await pom.close();
        await pom.page.reload();
        await pom.reopen();

        await expect(pom.exposureSelect).toHaveValue('public-url');
        await expect(pom.publicUrlInput).toHaveValue(data.publicUrl);
        await expect(pom.bearerTokenInput).toHaveAttribute(
          'placeholder',
          'Saved — enter a value to replace',
        );
      },
    },
    {
      id: 'configure-all-node-values',
      mode: 'mock',
      title: 'configures and persists every Webhooks node value',
      tags: ['@webhooks', '@integration', '@node'],
      async run({ data, expect, pom }) {
        await pom.createNode();
        await pom.nodeDirection.selectOption('outbound');
        await pom.nodeUrl.fill(data.targetUrl);
        await pom.nodeMethod.selectOption('PATCH');
        await pom.nodeRetries.fill('3');
        await pom.nodeHeaders.fill(data.headers);
        await pom.nodeBody.fill(data.body);
        await pom.nodeDirection.selectOption('inbound');
        await pom.saveReloadAndReopenNode();

        await expect(pom.nodeDirection).toHaveValue('inbound');
        await pom.nodeDirection.selectOption('outbound');
        await expect(pom.nodeUrl).toHaveValue(data.targetUrl);
        await expect(pom.nodeMethod).toHaveValue('PATCH');
        await expect(pom.nodeRetries).toHaveValue('3');
        await expect(pom.nodeHeaders).toHaveValue(data.headers);
        await expect(pom.nodeBody).toHaveValue(data.body);
      },
    },
  ],
});

export default webhooksE2EContribution;

export { createWebhooksE2EData } from './data';
export type { WebhooksE2EData } from './data';
export { WebhooksE2EPom } from './WebhooksE2EPom';
