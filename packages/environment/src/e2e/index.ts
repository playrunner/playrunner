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
  ],
});

export default environmentE2EContribution;

export { createEnvironmentE2EData } from './data';
export type { EnvironmentE2EData } from './data';
export { EnvironmentE2EPom } from './EnvironmentE2EPom';
