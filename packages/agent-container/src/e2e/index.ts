import { definePlayrunnerE2EContribution } from '@playrunner/integration-sdk/e2e';
import configuration from './configuration-scenarios';

export const agentContainerE2EContribution = definePlayrunnerE2EContribution({
  ...configuration,
  scenarios: [
    {
      id: 'hidden-from-discovery',
      mode: 'mock',
      title: 'keeps AI Container out of node and integration discovery',
      tags: ['@agent-container', '@integration', '@node'],
      async run({ expect, host, page }) {
        await host.openNewWorkflow();
        await page.getByTitle('Add Node').click();
        const selector = page.getByRole('dialog', {
          name: 'Add node',
          exact: true,
        });
        await expect(selector).toBeVisible();
        await expect(
          selector.getByTestId('node-selector-option-playwright'),
        ).toBeVisible();
        await expect(
          selector.getByTestId('node-selector-option-agent-container'),
        ).toHaveCount(0);
        await selector.getByPlaceholder('Search nodes...').fill('AI Container');
        await expect(
          selector.getByTestId('node-selector-option-agent-container'),
        ).toHaveCount(0);
        await host.gotoIntegrations();
        await expect(
          page.getByTestId('integration-card-agent-container'),
        ).toHaveCount(0);
      },
    },
  ],
});

export default agentContainerE2EContribution;
