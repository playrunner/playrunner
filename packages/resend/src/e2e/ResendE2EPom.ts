import type { Locator, Page } from '@playwright/test';
import type { PlayrunnerE2EHost } from '@playrunner/integration-sdk/e2e';

export class ResendE2EPom {
  readonly apiKeyInput: Locator;
  readonly apiKeyModeButton: Locator;
  readonly connectedHeading: Locator;
  readonly dialog: Locator;
  readonly disconnectButton: Locator;
  readonly receivingAddressInput: Locator;
  readonly saveButton: Locator;
  readonly setupGuideLink: Locator;

  constructor(
    readonly page: Page,
    private readonly host: PlayrunnerE2EHost,
  ) {
    this.dialog = page.getByRole('dialog', { name: 'Connect to Resend' });
    this.apiKeyModeButton = this.dialog.getByRole('button', {
      name: 'API key',
    });
    this.apiKeyInput = this.dialog.getByLabel('API key');
    this.receivingAddressInput = this.dialog.getByLabel(
      'Default receiving address (optional)',
    );
    this.saveButton = this.dialog.getByRole('button', { name: 'Save API key' });
    this.connectedHeading = this.dialog.getByRole('heading', {
      name: 'Resend Connected Successfully',
    });
    this.disconnectButton = this.dialog.getByRole('button', {
      name: 'Disconnect',
    });
    this.setupGuideLink = this.dialog.getByRole('link', {
      name: 'Open Playrunner setup guide',
    });
  }

  integrationCard() {
    return this.page.getByTestId('integration-card-resend');
  }

  async open() {
    await this.host.openIntegration({ id: 'resend', name: 'Resend' });
  }

  async close() {
    await this.dialog.getByTitle('Close').click();
  }

  async reloadAndOpen() {
    await this.page.reload();
    await this.open();
  }
}
