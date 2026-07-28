import type { Locator, Page } from '@playwright/test';
import type { PlayrunnerE2EHost } from '@playrunner/integration-sdk/e2e';

export class WebhooksE2EPom {
  readonly bearerTokenInput: Locator;
  readonly dialog: Locator;
  readonly exposureSelect: Locator;
  readonly publicUrlInput: Locator;
  readonly saveButton: Locator;

  constructor(
    readonly page: Page,
    private readonly host: PlayrunnerE2EHost,
  ) {
    this.dialog = page.getByRole('dialog', { name: 'Webhooks settings' });
    this.exposureSelect = this.dialog.getByLabel('Inbound exposure');
    this.publicUrlInput = this.dialog.getByLabel('Public HTTPS base URL');
    this.bearerTokenInput = this.dialog.getByLabel(
      'Default outbound bearer token',
    );
    this.saveButton = this.dialog.getByRole('button', {
      name: 'Save settings',
    });
  }

  integrationCard() {
    return this.page.getByTestId('integration-card-webhooks');
  }

  async open() {
    await this.host.gotoIntegrations();
    await this.integrationCard()
      .getByRole('button', { name: 'Connect' })
      .click();
    await this.dialog.waitFor();
  }

  async close() {
    await this.dialog.getByTitle('Close').click();
  }

  async enterBearerToken(bearerToken: string) {
    await this.bearerTokenInput.click();
    await this.bearerTokenInput.fill(bearerToken);
  }

  async enterPublicUrl(publicUrl: string) {
    await this.publicUrlInput.click();
    await this.publicUrlInput.fill(publicUrl);
  }

  async reopen() {
    await this.integrationCard()
      .getByRole('button', { name: 'Configure Webhooks' })
      .click();
    await this.dialog.waitFor();
  }
}
