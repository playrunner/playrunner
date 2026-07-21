import type { Locator, Page } from '@playwright/test';
import type { PlayrunnerE2EHost } from '@playrunner/integration-sdk/e2e';

export class GithubE2EPom {
  readonly appNameInput: Locator;
  readonly authenticateButton: Locator;
  readonly clientIdInput: Locator;
  readonly clientSecretInput: Locator;
  readonly dialog: Locator;
  readonly setupGuideLink: Locator;

  constructor(
    readonly page: Page,
    private readonly host: PlayrunnerE2EHost,
  ) {
    this.dialog = page.getByRole('dialog', { name: 'Connect to GitHub' });
    this.appNameInput = this.dialog.getByLabel('GitHub App Name (URL Slug)');
    this.clientIdInput = this.dialog.getByLabel('Client ID');
    this.clientSecretInput = this.dialog.getByLabel('Client Secret');
    this.authenticateButton = this.dialog.getByRole('button', {
      name: 'Authenticate',
    });
    this.setupGuideLink = this.dialog.getByRole('link', {
      name: 'Open GitHub setup guide',
    });
  }

  async open() {
    await this.host.openIntegration({ id: 'github', name: 'GitHub' });
  }
}
