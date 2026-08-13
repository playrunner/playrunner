import { definePlayrunnerE2EContribution } from '@playrunner/integration-sdk/e2e';
import { createOpenAIE2EData } from './data';
import { OpenAIE2EPom } from './OpenAIE2EPom';

export const openaiE2EContribution = definePlayrunnerE2EContribution({
  id: 'openai',
  createData: createOpenAIE2EData,
  createPom: ({ host, page }) => new OpenAIE2EPom(page, host),
  scenarios: [
    {
      id: 'manage-api-key',
      mode: 'mock',
      title: 'connects, reloads, and disconnects an OpenAI API key',
      tags: ['@openai', '@integration'],
      async run({ data, expect, pom }) {
        await pom.open();

        await expect(pom.dialog).toBeVisible();
        await expect(pom.setupGuideLink).toHaveAttribute('target', '_blank');
        await expect(pom.apiKeyInput).toHaveAttribute('type', 'password');
        await expect(pom.saveButton).toBeDisabled();

        await pom.enterApiKey(data.apiKey);
        await expect(pom.saveButton).toBeEnabled();
        await pom.saveButton.click();
        await expect(pom.connectedHeading).toBeVisible();

        await pom.close();
        await pom.reloadAndOpen();
        await expect(pom.connectedHeading).toBeVisible();

        await pom.disconnectButton.click();
        await expect(pom.apiKeyInput).toBeVisible();
        await pom.close();

        await pom.page.reload();
        await expect(
          pom.integrationCard().getByRole('button', { name: 'Connect' }),
        ).toBeVisible();
      },
    },
    {
      id: 'configure-all-node-values',
      mode: 'mock',
      title: 'configures and persists every OpenAI node value',
      tags: ['@openai', '@integration', '@node'],
      async run({ data, expect, pom }) {
        await pom.createNode();
        await pom.nodeModel.selectOption(data.model);
        await pom.nodePrompt.fill(data.prompt);
        await pom.nodeResponseFormat.selectOption('json_schema');
        await pom.nodeJsonSchema.fill(data.jsonSchema);
        await pom.nodeReasoningEffort.selectOption('xhigh');
        await pom.nodeVerbosity.selectOption('high');
        await pom.nodeMaxOutputTokens.fill(data.maxOutputTokens);
        await pom.saveReloadAndReopenNode();

        await expect(pom.nodeModel).toHaveValue(data.model);
        await expect(pom.nodePrompt).toHaveValue(data.prompt);
        await expect(pom.nodeResponseFormat).toHaveValue('json_schema');
        await expect(pom.nodeJsonSchema).toHaveValue(data.jsonSchema);
        await expect(pom.nodeReasoningEffort).toHaveValue('xhigh');
        await expect(pom.nodeVerbosity).toHaveValue('high');
        await expect(pom.nodeMaxOutputTokens).toHaveValue(
          data.maxOutputTokens,
        );
      },
    },
  ],
});

export default openaiE2EContribution;

export { createOpenAIE2EData } from './data';
export type { OpenAIE2EData } from './data';
export { OpenAIE2EPom } from './OpenAIE2EPom';
