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
  ],
});

export default jiraE2EContribution;

export { createJiraE2EData } from './data';
export type { JiraE2EData } from './data';
export { JiraE2EPom } from './JiraE2EPom';
