import type { Locator, Page } from '@playwright/test';
import type { PlayrunnerE2EHost } from '@playrunner/integration-sdk/e2e';

export class SlackE2EPom {
  readonly connectedHeading: Locator;
  readonly dialog: Locator;
  readonly disconnectButton: Locator;
  readonly saveButton: Locator;
  readonly setupGuideLink: Locator;
  readonly webhookModeButton: Locator;
  readonly webhookUrlInput: Locator;

  constructor(
    readonly page: Page,
    private readonly host: PlayrunnerE2EHost,
  ) {
    this.dialog = page.getByRole('dialog', { name: 'Connect to Slack' });
    this.webhookModeButton = this.dialog.getByRole('button', {
      name: 'Incoming Webhook',
    });
    this.webhookUrlInput = this.dialog.getByPlaceholder(
      'https://hooks.slack.com/services/...',
    );
    this.saveButton = this.dialog.getByRole('button', {
      name: 'Save Webhook',
    });
    this.connectedHeading = this.dialog.getByRole('heading', {
      name: 'Slack Connected Successfully',
    });
    this.disconnectButton = this.dialog.getByRole('button', {
      name: 'Disconnect',
    });
    this.setupGuideLink = this.dialog.getByRole('link', {
      name: 'Open Slack setup guide',
    });
  }

  integrationCard() {
    return this.page.getByTestId('integration-card-slack');
  }

  async open() {
    await this.host.openIntegration({ id: 'slack', name: 'Slack' });
  }

  async close() {
    await this.dialog.getByTitle('Close').click();
  }

  async selectWebhookMode() {
    await this.webhookModeButton.click();
  }

  async reloadAndOpen() {
    await this.page.reload();
    await this.open();
  }
}
