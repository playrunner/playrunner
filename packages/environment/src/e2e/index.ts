import { definePlayrunnerE2EContribution } from '@playrunner/integration-sdk/e2e';
import { createEnvironmentE2EData } from './data';
import { EnvironmentE2EPom } from './EnvironmentE2EPom';

export const environmentE2EContribution = definePlayrunnerE2EContribution({
  id: 'environment',
  createData: createEnvironmentE2EData,
  createPom: ({ host, page }) => new EnvironmentE2EPom(page, host),
  scenarios: [
    {
      id: 'configuration-only-composition',
      mode: 'mock',
      title: 'composes Environment as a configuration-only integration',
      tags: ['@environment', '@integration'],
      async run({ data, expect, pom }) {
        expect(data.runId).toBeTruthy();
        await pom.openCatalog();
        await expect(pom.integrationCard()).toHaveCount(0);
      },
    },
    {
      id: 'configure-persist-and-run-node',
      mode: 'mock',
      title: 'configures, persists, and runs an Environment node',
      tags: ['@environment', '@integration', '@node'],
      async run({ data, expect, pom }) {
        await pom.createNode();
        await expect(pom.dialog).toBeVisible();

        await pom.variableNameInput.fill(data.variableName);
        await pom.variableInitialValueInput.fill(data.variableValue);
        await pom.saveGloballyCheckbox.click();
        await expect(pom.environmentSelect).toContainText(data.environmentName);

        await pom.close();
        await pom.saveWorkflow();
        await pom.reloadWorkflow();
        await pom.reopen();

        await expect(pom.variableNameInput).toHaveValue(data.variableName);
        await expect(pom.variableInitialValueInput).toHaveValue(
          data.variableValue,
        );
        await expect(pom.environmentSelect).toContainText(data.environmentName);

        await pom.close();
        expect(await pom.runWorkflow()).toBe('success');
      },
    },
  ],
});

export default environmentE2EContribution;

export { createEnvironmentE2EData } from './data';
export type { EnvironmentE2EData } from './data';
export { EnvironmentE2EPom } from './EnvironmentE2EPom';
