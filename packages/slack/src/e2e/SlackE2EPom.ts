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
  readonly nodeChannel: Locator;
  readonly nodeMessage: Locator;
  readonly nodeUsername: Locator;

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
    this.nodeChannel = page.getByTestId('slack-node-channel');
    this.nodeMessage = page.getByTestId('slack-node-message');
    this.nodeUsername = page.getByTestId('slack-node-username');
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

  async connectWebhook(webhookUrl: string) {
    await this.open();
    await this.selectWebhookMode();
    await this.webhookUrlInput.fill(webhookUrl);
    await this.saveButton.click();
    await this.connectedHeading.waitFor();
    await this.close();
  }

  async createNode() {
    await this.host.openNewWorkflow();
    await this.host.addNode('slack');
    await this.host.openNodeSettings('slack');
  }

  async createOauthNode() {
    await this.host.openNewWorkflow();
    await this.page.evaluate(async () => {
      const rawSession = window.localStorage.getItem(
        'playrunner.localAuthSession',
      );
      const session = rawSession
        ? (JSON.parse(rawSession) as { token?: string })
        : undefined;
      const response = await fetch('/api/store/integrations/slack', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${session?.token ?? ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'slack',
          config: { authMode: 'oauth', teamName: 'Playrunner E2E' },
          secrets: { accessToken: 'slack-e2e-fake-token' },
        }),
      });
      if (!response.ok) {
        throw new Error(`Slack E2E setup failed with ${response.status}.`);
      }
    });
    await this.page.reload();
    await this.page.getByTitle('Add Node').waitFor();
    await this.host.addNode('slack');
    await this.host.openNodeSettings('slack');
  }

  async saveReloadAndReopenNode() {
    await this.host.closeNodeSettings();
    await this.host.saveWorkflow();
    await this.host.reloadWorkflow();
    await this.host.openNodeSettings('slack');
  }
}
