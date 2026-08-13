import { definePlayrunnerE2EContribution } from '@playrunner/integration-sdk/e2e';
import { createJiraE2EData } from './data';
import { JiraE2EPom } from './JiraE2EPom';

export const jiraE2EContribution = definePlayrunnerE2EContribution({
  id: 'jira',
  createData: createJiraE2EData,
  createPom: ({ host, page }) => new JiraE2EPom(page, host),
  scenarios: [
    {
      id: 'oauth-setup',
      mode: 'mock',
      title: 'validates the Jira OAuth setup form',
      tags: ['@jira', '@integration'],
      async run({ data, expect, pom }) {
        await pom.open();

        await pom.changeCredentialsButton.waitFor();
        await pom.changeCredentialsButton.click();

        await expect(pom.setupGuideLink).toHaveAttribute('target', '_blank');
        await expect(pom.clientSecretInput).toHaveAttribute('type', 'password');
        await expect(pom.authenticateButton).toBeDisabled();

        await pom.clientIdInput.click();
        await pom.clientIdInput.fill(data.clientId);
        await pom.clientSecretInput.click();
        await pom.clientSecretInput.fill(data.clientSecret);
        await expect(pom.authenticateButton).toBeEnabled();
      },
    },
    {
      id: 'create-issue-node-mock',
      mode: 'mock',
      title: 'configures, persists, and creates a Jira issue',
      tags: ['@jira', '@integration', '@node'],
      async run({ data, expect, pom }) {
        await pom.createNode();
        await expect(pom.nodeDialog).toBeVisible();
        await expect(pom.nodeProjectSelect).toContainText('Playrunner E2E');
        await pom.nodeActionSelect.selectOption('create');
        await pom.nodeProjectSelect.selectOption(data.projectId);
        await pom.nodeIssueTypeSelect.selectOption(data.issueType);
        await pom.nodeSummaryInput.fill(data.createSummary);
        await pom.nodeDescriptionInput.fill(data.createDescription);

        await pom.closeNode();
        await pom.saveAndReloadWorkflow();
        await pom.reopenNode();
        await expect(pom.nodeActionSelect).toHaveValue('create');
        await expect(pom.nodeProjectSelect).toHaveValue(data.projectId);
        await expect(pom.nodeIssueTypeSelect).toHaveValue(data.issueType);
        await expect(pom.nodeSummaryInput).toHaveValue(data.createSummary);
        await expect(pom.nodeDescriptionInput).toHaveValue(
          data.createDescription,
        );
      },
    },
    {
      id: 'update-issue-node-mock',
      mode: 'mock',
      title: 'configures, persists, and updates every Jira issue value',
      tags: ['@jira', '@integration', '@node'],
      async run({ data, expect, pom }) {
        await pom.createNode();
        await pom.nodeActionSelect.selectOption('update');
        await pom.nodeIssueKeyInput.fill(data.issueKey);
        await pom.nodeSummaryInput.fill(data.updateSummary);
        await pom.nodeDescriptionInput.fill(data.updateDescription);

        await pom.closeNode();
        await pom.saveAndReloadWorkflow();
        await pom.reopenNode();
        await expect(pom.nodeActionSelect).toHaveValue('update');
        await expect(pom.nodeIssueKeyInput).toHaveValue(data.issueKey);
        await expect(pom.nodeSummaryInput).toHaveValue(data.updateSummary);
        await expect(pom.nodeDescriptionInput).toHaveValue(
          data.updateDescription,
        );
      },
    },
    {
      id: 'create-issue-node-execution-mock',
      mode: 'mock',
      title: 'creates a Jira issue through the deterministic fake upstream',
      tags: ['@jira', '@integration', '@node', '@execution'],
      async run({ data, expect, pom }) {
        await pom.createNode();
        await expect(pom.nodeProjectSelect).toContainText('Playrunner E2E');
        await pom.nodeProjectSelect.selectOption(data.projectId);
        await pom.nodeIssueTypeSelect.selectOption(data.issueType);
        await pom.nodeSummaryInput.fill(data.createSummary);
        await pom.nodeDescriptionInput.fill(data.createDescription);
        await pom.closeNode();
        expect(await pom.runWorkflow()).toBe('success');

        const response = await fetch('http://127.0.0.1:4011/__e2e/issues');
        expect(response.ok).toBe(true);
        const issues = (await response.json()) as Array<{
          fields?: { summary?: string };
        }>;
        expect(
          issues.some((issue) => issue.fields?.summary === data.createSummary),
        ).toBe(true);
      },
    },
    {
      id: 'update-issue-node-execution-mock',
      mode: 'mock',
      title: 'updates a Jira issue through the deterministic fake upstream',
      tags: ['@jira', '@integration', '@node', '@execution'],
      async run({ data, expect, pom }) {
        await pom.createNode();
        await pom.nodeActionSelect.selectOption('update');
        await pom.nodeIssueKeyInput.fill(data.issueKey);
        await pom.nodeSummaryInput.fill(data.updateSummary);
        await pom.nodeDescriptionInput.fill(data.updateDescription);
        await pom.closeNode();
        expect(await pom.runWorkflow()).toBe('success');

        const response = await fetch('http://127.0.0.1:4011/__e2e/issues');
        expect(response.ok).toBe(true);
        const issues = (await response.json()) as Array<{
          key?: string;
          update?: { fields?: { summary?: string } };
        }>;
        expect(
          issues.some(
            (issue) =>
              issue.key === data.issueKey &&
              issue.update?.fields?.summary === data.updateSummary,
          ),
        ).toBe(true);
      },
    },
  ],
});

export default jiraE2EContribution;

export { createJiraE2EData } from './data';
export type { JiraE2EData } from './data';
export { JiraE2EPom } from './JiraE2EPom';
