import type { Locator, Page } from '@playwright/test';
import type { PlayrunnerE2EHost } from '@playrunner/integration-sdk/e2e';

export class GcpE2EPom {
  readonly authenticateButton: Locator;
  readonly clientIdInput: Locator;
  readonly clientSecretInput: Locator;
  readonly dialog: Locator;
  readonly setupGuideLink: Locator;

  constructor(
    readonly page: Page,
    private readonly host: PlayrunnerE2EHost,
  ) {
    this.dialog = page.getByRole('dialog', { name: 'Connect to GCP' });
    this.clientIdInput = this.dialog.getByLabel('Client ID');
    this.clientSecretInput = this.dialog.getByLabel('Client Secret');
    this.authenticateButton = this.dialog.getByRole('button', {
      name: 'Authenticate',
    });
    this.setupGuideLink = this.dialog.getByRole('link', {
      name: 'Open OAuth setup guide',
    });
  }

  async open() {
    await this.host.gotoIntegrations();
    await this.page
      .getByTestId('integration-card-gcp')
      .getByRole('button', { name: 'Connect' })
      .click();
    await this.dialog.waitFor();
  }
}
