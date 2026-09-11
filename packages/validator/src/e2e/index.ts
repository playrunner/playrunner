import { definePlayrunnerE2EContribution } from '@playrunner/integration-sdk/e2e';
import configuration from './configuration-scenarios';

export const validatorE2EContribution = definePlayrunnerE2EContribution({
  ...configuration,
  scenarios: [
    {
      id: 'hidden-from-discovery',
      mode: 'mock',
      title: 'keeps Test Validator out of node and integration discovery',
      tags: ['@validator', '@integration', '@node'],
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
          selector.getByTestId('node-selector-option-validator'),
        ).toHaveCount(0);
        await selector
          .getByPlaceholder('Search nodes...')
          .fill('Test Validator');
        await expect(
          selector.getByTestId('node-selector-option-validator'),
        ).toHaveCount(0);
        await host.gotoIntegrations();
        await expect(
          page.getByTestId('integration-card-validator'),
        ).toHaveCount(0);
      },
    },
  ],
});

export default validatorE2EContribution;
