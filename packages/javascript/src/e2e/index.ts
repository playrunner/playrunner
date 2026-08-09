import { definePlayrunnerE2EContribution } from '@playrunner/integration-sdk/e2e';
import { createJavascriptE2EData } from './data';
import { JavascriptE2EPom } from './JavascriptE2EPom';

export const javascriptE2EContribution = definePlayrunnerE2EContribution({
  id: 'code',
  createData: createJavascriptE2EData,
  createPom: ({ host, page }) => new JavascriptE2EPom(page, host),
  scenarios: [
    {
      id: 'configuration-only-composition',
      mode: 'mock',
      title: 'composes Javascript Code as a configuration-only integration',
      tags: ['@code', '@integration'],
      async run({ data, expect, pom }) {
        expect(data.runId).toBeTruthy();
        await pom.openCatalog();
        await expect(pom.integrationCard()).toHaveCount(0);
      },
    },
    {
      id: 'configure-persist-and-run-node',
      mode: 'mock',
      title: 'configures, persists, and runs a Javascript node',
      tags: ['@code', '@integration', '@node'],
      async run({ data, expect, pom }) {
        await pom.createNode();
        await pom.scriptInput.fill(data.code);
        await pom.saveReloadAndReopenNode();
        await expect(pom.scriptInput).toHaveValue(data.code);
        await pom.closeNode();
        expect(await pom.runWorkflow()).toBe('success');
      },
    },
  ],
});

export default javascriptE2EContribution;

export { createJavascriptE2EData } from './data';
export type { JavascriptE2EData } from './data';
export { JavascriptE2EPom } from './JavascriptE2EPom';
