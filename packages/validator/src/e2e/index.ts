import { definePlayrunnerE2EContribution } from '@playrunner/integration-sdk/e2e';

export const validatorE2EContribution = definePlayrunnerE2EContribution({
  id: 'validator',
  createData: ({ runId }) => ({ runId }),
  createPom: ({ host, page }) => ({ host, page }),
  scenarios: [
    {
      id: 'configure-validator',
      mode: 'mock',
      title: 'configures and persists a Validator attachment',
      tags: ['@validator', '@integration', '@node'],
      async run({ expect, host, page }) {
        await host.openNewWorkflow();
        await host.addNode('validator');
        await host.openNodeSettings('validator');
        await page.getByTestId('validator-lineCoverage').fill('75');
        await page
          .getByTestId('validator-requirements')
          .fill('PAYMENT-SUCCESS: successful payment');
        await host.closeNodeSettings();
        await host.saveWorkflow();
        await host.reloadWorkflow();
        await host.openNodeSettings('validator');
        await expect(page.getByTestId('validator-lineCoverage')).toHaveValue(
          '75',
        );
      },
    },
  ],
});

export default validatorE2EContribution;
