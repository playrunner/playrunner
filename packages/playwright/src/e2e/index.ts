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
    {
      id: 'configure-clone-environment-and-resources',
      mode: 'mock',
      title: 'persists every Playwright clone, environment, and resource value',
      tags: ['@playwright', '@integration', '@node'],
      async run({ data, expect, pom }) {
        await pom.createNode();
        await pom.field('dismiss-language-info').click();
        await pom.field('action').selectOption('clone');
        await expect(pom.field('repository')).toContainText(
          'playrunner/e2e-fixture',
        );
        await pom.field('repository').selectOption('playrunner/e2e-fixture');
        await expect(pom.field('branch')).toContainText('main');
        await pom.field('branch').selectOption('main');
        await pom.field('test-language').selectOption('python');
        await pom.field('folder').fill(data.folder);
        await pom.field('tab-env').click();
        const versions = await pom.field('version').locator('option').count();
        await pom.field('version').selectOption({ index: versions - 1 });
        const version = await pom.field('version').inputValue();
        await pom.dropEnvironmentVariable('PLAYRUNNER_E2E');
        await pom.field('tab-resources').click();
        await pom.field('cpu').selectOption('8');
        await pom.field('memory').selectOption('16');
        await pom.field('workers').fill('12');
        await pom.saveReloadAndReopenNode();

        await expect(pom.field('dismiss-language-info')).toHaveCount(0);
        await expect(pom.field('action')).toHaveValue('clone');
        await expect(pom.field('repository')).toHaveValue(
          'playrunner/e2e-fixture',
        );
        await expect(pom.field('branch')).toHaveValue('main');
        await expect(pom.field('test-language')).toHaveValue('python');
        await expect(pom.field('folder')).toHaveValue(data.folder);
        await pom.field('tab-env').click();
        await expect(pom.field('version')).toHaveValue(version);
        await expect(pom.field('env-vars')).toContainText('env.PLAYRUNNER_E2E');
        await pom.field('tab-resources').click();
        await expect(pom.field('cpu')).toHaveValue('8');
        await expect(pom.field('memory')).toHaveValue('16');
        await expect(pom.field('workers')).toHaveValue('12');
      },
    },
    {
      id: 'configure-run-and-upload-values',
      mode: 'mock',
      title: 'persists Playwright inline script and upload values',
      tags: ['@playwright', '@integration', '@node'],
      async run({ data, expect, pom }) {
        await pom.createNode();
        await pom.field('action').selectOption('run');
        await pom.fillScript(data.script);
        await pom.field('action').selectOption('upload');
        await pom.field('zip-file').setInputFiles({
          buffer: Buffer.from('playrunner-e2e'),
          mimeType: 'application/zip',
          name: data.zipFileName,
        });
        await pom.saveReloadAndReopenNode();
        await expect(pom.field('action')).toHaveValue('upload');
        await expect(pom.field('zip-file-name')).toHaveText(data.zipFileName);
        await pom.field('action').selectOption('run');
        await expect(pom.field('script')).toHaveAttribute(
          'data-script-value',
          data.script,
        );
      },
    },
  ],
});

export default playwrightE2EContribution;

export { createPlaywrightE2EData } from './data';
export type { PlaywrightE2EData } from './data';
export { PlaywrightE2EPom } from './PlaywrightE2EPom';
