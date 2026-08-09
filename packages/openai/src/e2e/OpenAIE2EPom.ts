import type { Locator, Page } from '@playwright/test';
import type { PlayrunnerE2EHost } from '@playrunner/integration-sdk/e2e';

export class OpenAIE2EPom {
  readonly apiKeyInput: Locator;
  readonly connectedHeading: Locator;
  readonly dialog: Locator;
  readonly disconnectButton: Locator;
  readonly saveButton: Locator;
  readonly setupGuideLink: Locator;
  readonly nodeJsonSchema: Locator;
  readonly nodeMaxOutputTokens: Locator;
  readonly nodeModel: Locator;
  readonly nodePrompt: Locator;
  readonly nodeReasoningEffort: Locator;
  readonly nodeResponseFormat: Locator;
  readonly nodeVerbosity: Locator;

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
    this.nodeJsonSchema = page.getByTestId('openai-node-json-schema');
    this.nodeMaxOutputTokens = page.getByTestId(
      'openai-node-max-output-tokens',
    );
    this.nodeModel = page.getByTestId('openai-node-model');
    this.nodePrompt = page.getByTestId('openai-node-prompt');
    this.nodeReasoningEffort = page.getByTestId(
      'openai-node-reasoning-effort',
    );
    this.nodeResponseFormat = page.getByTestId(
      'openai-node-response-format',
    );
    this.nodeVerbosity = page.getByTestId('openai-node-verbosity');
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

  async createNode() {
    await this.host.openNewWorkflow();
    await this.host.addNode('openai');
    await this.host.openNodeSettings('openai');
  }

  async saveReloadAndReopenNode() {
    await this.host.closeNodeSettings();
    await this.host.saveWorkflow();
    await this.host.reloadWorkflow();
    await this.host.openNodeSettings('openai');
  }
}
