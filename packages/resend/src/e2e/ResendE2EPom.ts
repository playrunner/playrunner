import type { Locator, Page } from '@playwright/test';
import type { PlayrunnerE2EHost } from '@playrunner/integration-sdk/e2e';

export class ResendE2EPom {
  readonly apiKeyInput: Locator;
  readonly apiKeyModeButton: Locator;
  readonly connectModeButton: Locator;
  readonly connectedHeading: Locator;
  readonly dialog: Locator;
  readonly disconnectButton: Locator;
  readonly nodeDialog: Locator;
  readonly receivingAddressInput: Locator;
  readonly recipientTextarea: Locator;
  readonly saveButton: Locator;
  readonly setupGuideLink: Locator;

  constructor(
    readonly page: Page,
    private readonly host: PlayrunnerE2EHost,
  ) {
    this.dialog = page.getByRole('dialog', { name: 'Connect to Resend' });
    this.nodeDialog = page.getByRole('dialog', { name: 'Resend' });
    this.apiKeyModeButton = this.dialog.getByRole('button', {
      name: 'API key',
      exact: true,
    });
    this.connectModeButton = this.dialog.getByRole('button', {
      name: 'Connect to Resend',
    });
    this.apiKeyInput = this.dialog.getByLabel('API key');
    this.receivingAddressInput = this.dialog.getByLabel(
      'Default receiving address (optional)',
    );
    this.recipientTextarea =
      this.nodeDialog.getByPlaceholder('user@example.com');
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

  async createNodeWithEnvironmentVariable(
    variableName: string,
    variableValue: string,
  ) {
    await this.host.openNewWorkflow();
    await this.host.addNode('environment');
    await this.host.openNodeSettings('environment');
    const environmentDialog = this.page.getByRole('dialog', {
      name: 'Environment',
    });
    await environmentDialog.getByLabel('Variable 1 name').fill(variableName);
    await environmentDialog
      .getByLabel('Variable 1 initial value')
      .fill(variableValue);
    await this.host.closeNodeSettings();
    const environmentNode = this.page
      .getByTestId('canvas-node-environment')
      .last();
    await environmentNode
      .getByRole('button', { name: 'Add connected node' })
      .click();
    await this.page.getByTestId('node-selector-option-resend').click();
    await this.page.getByTestId('canvas-node-resend').last().waitFor();
    await this.host.openNodeSettings('resend');
  }

  async dragEnvironmentVariableToRecipient(variableName: string) {
    await this.page
      .getByTestId(`input-environment-variable-${variableName}`)
      .dragTo(this.recipientTextarea);
  }

  async closeNodeSettings() {
    await this.host.closeNodeSettings();
  }

  async saveAndReloadWorkflow() {
    await this.host.saveWorkflow();
    await this.host.reloadWorkflow();
  }

  async reopenNodeSettings() {
    await this.host.openNodeSettings('resend');
  }
}
