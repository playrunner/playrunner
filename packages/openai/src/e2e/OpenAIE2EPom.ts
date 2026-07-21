import type { Locator, Page } from '@playwright/test';
import type { PlayrunnerE2EHost } from '@playrunner/integration-sdk/e2e';

export class OpenAIE2EPom {
  readonly apiKeyInput: Locator;
  readonly connectedHeading: Locator;
  readonly dialog: Locator;
  readonly disconnectButton: Locator;
  readonly saveButton: Locator;
  readonly setupGuideLink: Locator;

  constructor(
    readonly page: Page,
    private readonly host: PlayrunnerE2EHost,
  ) {
    this.dialog = page.getByRole('dialog', { name: 'Connect to OpenAI' });
    this.apiKeyInput = this.dialog.getByLabel('API key');
    this.saveButton = this.dialog.getByRole('button', {
      name: 'Save API key',
    });
    this.connectedHeading = this.dialog.getByRole('heading', {
      name: 'OpenAI Connected Successfully',
    });
    this.disconnectButton = this.dialog.getByRole('button', {
      name: 'Disconnect',
    });
    this.setupGuideLink = this.dialog.getByRole('link', {
      name: 'Open OpenAI setup guide',
    });
  }

  integrationCard() {
    return this.page.getByTestId('integration-card-openai');
  }

  async open() {
    await this.host.openIntegration({ id: 'openai', name: 'OpenAI' });
  }

  async close() {
    await this.dialog.getByTitle('Close').click();
  }

  async enterApiKey(apiKey: string) {
    await this.apiKeyInput.click();
    await this.apiKeyInput.fill(apiKey);
  }

  async reloadAndOpen() {
    await this.page.reload();
    await this.open();
  }
}
