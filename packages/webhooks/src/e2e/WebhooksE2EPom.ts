import type { Locator, Page } from '@playwright/test';
import type { PlayrunnerE2EHost } from '@playrunner/integration-sdk/e2e';

export class WebhooksE2EPom {
  readonly bearerTokenInput: Locator;
  readonly dialog: Locator;
  readonly exposureSelect: Locator;
  readonly publicUrlInput: Locator;
  readonly saveButton: Locator;
  readonly nodeBody: Locator;
  readonly nodeDirection: Locator;
  readonly nodeHeaders: Locator;
  readonly nodeMethod: Locator;
  readonly nodeRetries: Locator;
  readonly nodeUrl: Locator;

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
    this.nodeBody = page.getByTestId('webhooks-node-body');
    this.nodeDirection = page.getByTestId('webhooks-node-direction');
    this.nodeHeaders = page.getByTestId('webhooks-node-headers');
    this.nodeMethod = page.getByTestId('webhooks-node-method');
    this.nodeRetries = page.getByTestId('webhooks-node-retries');
    this.nodeUrl = page.getByTestId('webhooks-node-url');
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

  async createNode() {
    await this.host.openNewWorkflow();
    await this.host.addNode('webhooks');
    await this.host.openNodeSettings('webhooks');
  }

  async saveReloadAndReopenNode() {
    await this.host.closeNodeSettings();
    await this.host.saveWorkflow();
    await this.host.reloadWorkflow();
    await this.host.openNodeSettings('webhooks');
  }
}
