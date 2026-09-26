import { createTestSuiteZip, testPlanMarkdown } from './test-suite-fixture';
import { definePlayrunnerE2EContribution } from '@playrunner/integration-sdk/e2e';
import { createPlaywrightE2EData } from './data';
import { PlaywrightE2EPom } from './PlaywrightE2EPom';

export const playwrightE2EContribution = definePlayrunnerE2EContribution({
  id: 'playwright',
  createData: createPlaywrightE2EData,
  createPom: ({ host, page }) => new PlaywrightE2EPom(page, host),
  scenarios: [
    {
      id: 'uploaded-test-plan-report',
      mode: 'mock',
      title:
        'executes an uploaded suite and preserves versioned test plan outcomes',
      tags: ['@playwright', '@test-plan'],
      async run({ data, expect, pom, page, host }) {
        await pom.createNode();
        await pom.field('action').selectOption('upload');
        await pom.field('zip-file').setInputFiles({
          buffer: createTestSuiteZip(),
          mimeType: 'application/zip',
          name: data.zipFileName,
        });
        await expect(pom.field('zip-file-name')).toHaveText(data.zipFileName);
        await host.closeNodeSettings();
        await page
          .getByRole('button', { name: 'Test plan', exact: true })
          .click();
        const dialog = page.getByRole('dialog', {
          name: 'Workflow test plan',
          exact: true,
        });
        const savePlan = async () => {
          const saved = page.waitForResponse(
            (r) =>
              r.url().includes('/api/store/workflows/') &&
              r.request().method() === 'PUT',
          );
          await dialog
            .getByRole('button', { name: 'Save workflow', exact: true })
            .click();
          expect((await saved).ok()).toBe(true);
        };
        const panel = page.getByRole('region', {
          name: 'Test plan',
          exact: true,
        });
        await panel.getByLabel('Upload test plan').setInputFiles({
          buffer: Buffer.from(testPlanMarkdown),
          mimeType: 'text/markdown',
          name: 'regression.md',
        });
        await expect(
          panel.getByRole('group', { name: /^Case \d+$/ }),
        ).toHaveCount(5);
        const cases = panel.getByRole('group', { name: /^Case \d+$/ });
        await cases
          .nth(0)
          .getByLabel('Required tests')
          .fill('desktop :: passes\nmobile :: passes');
        await cases
          .nth(1)
          .getByLabel('Required tests')
          .fill('desktop :: fails');
        await cases
          .nth(2)
          .getByLabel('Required tests')
          .fill('desktop :: skipped');
        await panel
          .getByRole('heading', { name: 'Workflow test plan' })
          .click();
        await savePlan();
        await page.reload();
        await page
          .getByRole('button', { name: 'Test plan', exact: true })
          .click();
        await expect(
          panel
            .getByRole('group', { name: /^Case \d+$/ })
            .nth(0)
            .getByLabel('Required tests'),
        ).toHaveValue('desktop :: passes\nmobile :: passes');
        await dialog
          .getByRole('button', { name: 'Close', exact: true })
          .click();
        const response = page.waitForResponse(
          (r) =>
            r.url().endsWith('/api/workflows/start') &&
            r.request().method() === 'POST',
        );
        expect(await host.runWorkflowNode('playwright')).toBe('error');
        const run = await (await response).json();
        const snapshot = await page.evaluate(async (id) => {
          const session = JSON.parse(
            localStorage.getItem('playrunner.localAuthSession') || '{}',
          );
          const response = await fetch('/api/executions/live', {
            headers: { Authorization: `Bearer ${session.token}` },
          });
          const payload = await response.json();
          return payload.executions.find((e: { id: string }) => e.id === id);
        }, run.testId);
        const node = snapshot.nodes.find(
          (n: { reportUrl: string | null }) => n.reportUrl,
        );
        expect(node, JSON.stringify(snapshot)).toBeTruthy();
        // Use the same authenticated report opening path as the product.
        await page.goto('/executions');
        const region = page.getByRole('region', {
          name: `Execution ${run.testId}`,
          exact: true,
        });
        const report = await page.context().newPage();
        const reportUrl = await region
          .getByRole('link', { name: 'Test plan report', exact: true })
          .getAttribute('href');
        expect(reportUrl).toBeTruthy();
        await report.goto(reportUrl!);
        await expect(
          report.getByRole('heading', {
            name: 'Overall plan: FAIL',
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          report
            .getByRole('row')
            .filter({ hasText: 'PASS-01' })
            .getByText('PASS', { exact: true }),
        ).toBeVisible();
        await expect(
          report.getByRole('row').filter({ hasText: 'SKIP-01' }),
        ).toContainText('SKIPPED');
        await expect(
          report.getByRole('row').filter({ hasText: 'MANUAL-01' }),
        ).toContainText('NOT RUN');
        const original = await report.locator('pre').textContent();
        const version = await report
          .getByText('Plan version:', { exact: false })
          .textContent();
        await report.close();
        await page.goto(`/workflow/${snapshot.workflowId}`);
        await page
          .getByRole('button', { name: 'Test plan', exact: true })
          .click();
        await panel.getByLabel('Upload test plan').setInputFiles({
          buffer: Buffer.from('# Replacement plan'),
          mimeType: 'text/markdown',
          name: 'replacement.md',
        });
        await savePlan();
        await expect(
          panel.getByText('replacement.md', { exact: true }),
        ).toBeVisible();
        const oldReport = await page.context().newPage();
        await oldReport.goto(reportUrl!);
        await expect(oldReport.locator('pre')).toHaveText(original!);
        await expect(
          oldReport.getByText('Plan version:', { exact: false }),
        ).toHaveText(version!);
        await oldReport.close();
      },
    },
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
      id: 'compact-node-settings-layout',
      mode: 'mock',
      title: 'keeps tabs and resource settings visible at compact widths',
      tags: ['@playwright', '@integration', '@node'],
      async run({ expect, page, pom }) {
        await page.setViewportSize({ width: 1056, height: 539 });
        await pom.createNode();

        const tabs = pom.field('tabs');
        await expect(tabs).toBeVisible();
        await expect(pom.field('tab-config')).toHaveAttribute(
          'aria-selected',
          'true',
        );
        await pom.field('tab-resources').click();
        await expect(pom.field('tab-resources')).toHaveAttribute(
          'aria-selected',
          'true',
        );

        const tabLayout = await tabs.evaluate((element) => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        }));
        expect(tabLayout.scrollWidth).toBeLessThanOrEqual(
          tabLayout.clientWidth,
        );

        const resourceLimits = pom.field('resource-limits');
        await expect(resourceLimits).toBeVisible();
        const resourceLayout = await resourceLimits.evaluate((element) => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        }));
        expect(resourceLayout.scrollWidth).toBeLessThanOrEqual(
          resourceLayout.clientWidth,
        );
        await expect(pom.field('cpu')).toBeVisible();
        await expect(pom.field('memory')).toBeVisible();
        await expect(pom.field('workers')).toBeVisible();
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
          buffer: createTestSuiteZip(),
          mimeType: 'application/zip',
          name: data.zipFileName,
        });
        await expect(pom.field('zip-file-name')).toHaveText(data.zipFileName);
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
