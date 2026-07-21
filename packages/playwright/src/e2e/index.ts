import { definePlayrunnerE2EContribution } from '@playrunner/integration-sdk/e2e';
import { createPlaywrightE2EData } from './data';
import { PlaywrightE2EPom } from './PlaywrightE2EPom';

export const playwrightE2EContribution = definePlayrunnerE2EContribution({
  id: 'playwright',
  createData: createPlaywrightE2EData,
  createPom: ({ host, page }) => new PlaywrightE2EPom(page, host),
  scenarios: [
    {
      id: 'node-only-composition',
      mode: 'mock',
      title: 'composes Playwright as a node-only integration',
      tags: ['@playwright', '@integration'],
      async run({ data, expect, pom }) {
        expect(data.runId).toBeTruthy();
        await pom.openCatalog();
        await expect(pom.integrationCard()).toHaveCount(0);
      },
    },
  ],
});

export default playwrightE2EContribution;

export { createPlaywrightE2EData } from './data';
export type { PlaywrightE2EData } from './data';
export { PlaywrightE2EPom } from './PlaywrightE2EPom';
