import { definePlayrunnerE2EContribution } from '@playrunner/integration-sdk/e2e';
import { createTeamsE2EData } from './data';
import { TeamsE2EPom } from './TeamsE2EPom';
export default definePlayrunnerE2EContribution({
  id: 'microsoft-teams',
  createData: createTeamsE2EData,
  createPom: ({ page, host }) => new TeamsE2EPom(page, host),
  scenarios: [
    {
      id: 'connect-reload-disconnect',
      mode: 'mock',
      title: 'connects Teams through OAuth, reloads, and disconnects',
      tags: ['@microsoft-teams', '@integration'],
      async run({ data, expect, page, pom }) {
        await pom.fakeAuthorization();
        await pom.open();
        await expect(pom.connectButton).toBeDisabled();
        await expect(
          pom.dialog.getByRole('link', {
            name: 'Open Microsoft Teams setup guide',
          }),
        ).toHaveAttribute('target', '_blank');
        await expect(
          pom.dialog.getByLabel('Client secret', { exact: true }),
        ).toHaveAttribute('type', 'password');
        await pom.fill(data);
        await pom.connectButton.click();
        await expect(pom.connectedHeading).toBeVisible();
        await pom.close();
        await page.reload();
        await pom.open();
        await expect(pom.connectedHeading).toBeVisible();
        await pom.dialog
          .getByRole('button', { name: 'Disconnect', exact: true })
          .click();
        await expect(pom.connectButton).toBeDisabled();
        await pom.close();
        await page.reload();
        await expect(
          page
            .getByTestId('integration-card-microsoft-teams')
            .getByRole('button', { name: 'Connect', exact: true }),
        ).toBeVisible();
      },
    },
    {
      id: 'configure-message',
      mode: 'mock',
      title:
        'persists Teams channel and templated message and clears channel when team changes',
      tags: ['@microsoft-teams', '@integration', '@node'],
      async run({ data, expect, pom }) {
        await pom.connect(data);
        await pom.createNode();
        await pom.team.selectOption('engineering');
        await pom.channel.selectOption('engineering-results');
        await pom.message.fill(data.message);
        await pom.team.selectOption('quality');
        await expect(pom.channel).toHaveValue('');
        await pom.channel.selectOption('quality-results');
        await pom.reloadNode();
        await expect(pom.team).toHaveValue('quality');
        await expect(pom.channel).toHaveValue('quality-results');
        await expect(pom.message).toHaveValue(data.message);
      },
    },
    {
      id: 'oauth-denied',
      mode: 'mock',
      title: 'shows an actionable Teams authorization failure',
      tags: ['@microsoft-teams', '@integration'],
      async run({ data, expect, pom }) {
        await pom.fakeAuthorization(true);
        await pom.open();
        await pom.fill(data);
        await pom.connectButton.click();
        await expect(pom.dialog.getByRole('alert')).toHaveText(
          'Microsoft Teams authorization was not completed.',
        );
        await expect(pom.connectButton).toBeEnabled();
        await expect(pom.connectedHeading).toHaveCount(0);
      },
    },
  ],
});
