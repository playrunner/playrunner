import { definePlayrunnerE2EContribution } from '@playrunner/integration-sdk/e2e';

export const codexCliE2EContribution = definePlayrunnerE2EContribution({
  id: 'codex-cli',
  createData: ({ runId }) => ({ runId }),
  createPom: ({ host, page }) => ({ host, page }),
  scenarios: [
    {
      id: 'configure-codex-cli',
      mode: 'mock',
      title: 'configures and persists a Codex CLI attachment',
      tags: ['@codex-cli', '@integration', '@node'],
      async run({ expect, host, page }) {
        await host.openNewWorkflow();
        await host.addNode('codex-cli');
        await host.openNodeSettings('codex-cli');
        await expect(page.getByText('Input', { exact: true })).toBeVisible();
        const apiKey = page.getByTestId('codex-cli-api-key');
        await apiKey.evaluate((field) => {
          const dataTransfer = new DataTransfer();
          dataTransfer.setData('text/plain', 'process.env.OPENAI_API_KEY');
          field.dispatchEvent(
            new DragEvent('drop', { bubbles: true, dataTransfer }),
          );
        });
        await expect(apiKey).toHaveValue('{{env.OPENAI_API_KEY}}');
        const model = page.getByTestId('codex-cli-model');
        await expect(model).toContainText('GPT-5.6 Sol');
        await expect(model).toContainText('GPT-5.6 Terra');
        await expect(model).toContainText('GPT-5.6 Luna');
        await model.selectOption('gpt-5.6-terra');
        await page
          .getByTestId('codex-cli-reasoning-effort')
          .selectOption('high');
        await host.closeNodeSettings();
        await host.saveWorkflow();
        await host.reloadWorkflow();
        await host.openNodeSettings('codex-cli');
        await expect(page.getByTestId('codex-cli-model')).toHaveValue(
          'gpt-5.6-terra',
        );
        await expect(page.getByTestId('codex-cli-api-key')).toHaveValue(
          '{{env.OPENAI_API_KEY}}',
        );
      },
    },
  ],
});

export default codexCliE2EContribution;
