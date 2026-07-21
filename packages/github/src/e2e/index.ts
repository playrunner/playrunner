import { definePlayrunnerE2EContribution } from '@playrunner/integration-sdk/e2e';
import { createGithubE2EData } from './data';
import { GithubE2EPom } from './GithubE2EPom';

export const githubE2EContribution = definePlayrunnerE2EContribution({
  id: 'github',
  createData: createGithubE2EData,
  createPom: ({ host, page }) => new GithubE2EPom(page, host),
  scenarios: [
    {
      id: 'oauth-setup',
      mode: 'mock',
      title: 'validates the GitHub OAuth setup form',
      tags: ['@github', '@integration'],
      async run({ data, expect, pom }) {
        await pom.open();

        await expect(pom.setupGuideLink).toHaveAttribute('target', '_blank');
        await expect(pom.clientSecretInput).toHaveAttribute('type', 'password');
        await expect(pom.authenticateButton).toBeDisabled();

        await pom.appNameInput.click();
        await pom.appNameInput.fill(data.appName);
        await pom.clientIdInput.click();
        await pom.clientIdInput.fill(data.clientId);
        await pom.clientSecretInput.click();
        await pom.clientSecretInput.fill(data.clientSecret);
        await expect(pom.authenticateButton).toBeEnabled();
      },
    },
  ],
});

export default githubE2EContribution;

export { createGithubE2EData } from './data';
export type { GithubE2EData } from './data';
export { GithubE2EPom } from './GithubE2EPom';
