import type { Locator, Page } from '@playwright/test';
import type { PlayrunnerE2EHost } from '@playrunner/integration-sdk/e2e';

export class GithubE2EPom {
  readonly appNameInput: Locator;
  readonly authenticateButton: Locator;
  readonly clientIdInput: Locator;
  readonly clientSecretInput: Locator;
  readonly dialog: Locator;
  readonly setupGuideLink: Locator;
  readonly connectedHeading: Locator;
  readonly nodeActionSelect: Locator;
  readonly nodeBodyInput: Locator;
  readonly nodeDialog: Locator;
  readonly nodeRepositorySelect: Locator;
  readonly nodeTitleInput: Locator;

  constructor(
    readonly page: Page,
    private readonly host: PlayrunnerE2EHost,
  ) {
    this.dialog = page.getByRole('dialog', { name: 'Connect to GitHub' });
    this.appNameInput = this.dialog.getByLabel('GitHub App Name (URL Slug)');
    this.clientIdInput = this.dialog.getByLabel('Client ID');
    this.clientSecretInput = this.dialog.getByLabel('Client Secret');
    this.authenticateButton = this.dialog.getByRole('button', {
      name: 'Authenticate',
    });
    this.setupGuideLink = this.dialog.getByRole('link', {
      name: 'Open GitHub setup guide',
    });
    this.connectedHeading = this.dialog.getByRole('heading', {
      name: 'GitHub Connected Successfully',
    });
    this.nodeDialog = page.getByRole('dialog', { name: 'GitHub' });
    this.nodeActionSelect = this.nodeDialog.getByLabel('Action');
    this.nodeRepositorySelect = this.nodeDialog.getByLabel('Repository');
    this.nodeTitleInput = this.nodeDialog.getByLabel('Title');
    this.nodeBodyInput = this.nodeDialog.getByLabel('Body');
  }

  async open() {
    await this.host.openIntegration({ id: 'github', name: 'GitHub' });
  }

  async closeConnection() {
    await this.dialog.getByRole('button', { name: 'Close Menu' }).click();
  }

  async createIssueNode() {
    await this.host.openNewWorkflow();
    await this.host.addNode('github');
    await this.host.openNodeSettings('github');
  }

  nodeField(name: string) {
    return this.page.getByTestId(`github-node-${name}`);
  }

  async closeNode() {
    await this.host.closeNodeSettings();
  }

  async reopenNode() {
    await this.host.openNodeSettings('github');
  }

  async reloadWorkflow() {
    await this.host.reloadWorkflow();
  }

  async saveWorkflow() {
    await this.host.saveWorkflow();
  }

  async runWorkflow() {
    return this.host.runWorkflowNode('github');
  }
}
