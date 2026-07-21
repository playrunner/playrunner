import type { Locator, Page } from '@playwright/test';
import type { PlayrunnerE2EHost } from '@playrunner/integration-sdk/e2e';

export class JiraE2EPom {
  readonly authenticateButton: Locator;
  readonly clientIdInput: Locator;
  readonly clientSecretInput: Locator;
  readonly dialog: Locator;
  readonly setupGuideLink: Locator;

  constructor(
    readonly page: Page,
    private readonly host: PlayrunnerE2EHost,
  ) {
    this.dialog = page.getByRole('dialog', { name: 'Connect to Jira' });
    this.clientIdInput = this.dialog.getByLabel('Client ID');
    this.clientSecretInput = this.dialog.getByLabel('Client Secret');
    this.authenticateButton = this.dialog.getByRole('button', {
      name: 'Authenticate',
    });
    this.setupGuideLink = this.dialog.getByRole('link', {
      name: 'Open Jira setup guide',
    });
  }

  async open() {
    await this.host.openIntegration({ id: 'jira', name: 'Jira' });
  }
}
