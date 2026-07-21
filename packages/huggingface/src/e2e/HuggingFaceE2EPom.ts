import type { Locator, Page } from '@playwright/test';
import type { PlayrunnerE2EHost } from '@playrunner/integration-sdk/e2e';

export class HuggingFaceE2EPom {
  readonly accessTokenInput: Locator;
  readonly connectedHeading: Locator;
  readonly dialog: Locator;
  readonly disconnectButton: Locator;
  readonly saveButton: Locator;
  readonly setupGuideLink: Locator;

  constructor(
    readonly page: Page,
    private readonly host: PlayrunnerE2EHost,
  ) {
    this.dialog = page.getByRole('dialog', {
      name: 'Connect to Hugging Face',
    });
    this.accessTokenInput = this.dialog.getByLabel('Access token');
    this.saveButton = this.dialog.getByRole('button', {
      name: 'Save access token',
    });
    this.connectedHeading = this.dialog.getByRole('heading', {
      name: 'Hugging Face Connected Successfully',
    });
    this.disconnectButton = this.dialog.getByRole('button', {
      name: 'Disconnect',
    });
    this.setupGuideLink = this.dialog.getByRole('link', {
      name: 'Open Hugging Face setup guide',
    });
  }

  integrationCard() {
    return this.page.getByTestId('integration-card-huggingface');
  }

  async open() {
    await this.host.openIntegration({
      id: 'huggingface',
      name: 'Hugging Face',
    });
  }

  async close() {
    await this.dialog.getByTitle('Close').click();
  }

  async reloadAndOpen() {
    await this.page.reload();
    await this.open();
  }
}
