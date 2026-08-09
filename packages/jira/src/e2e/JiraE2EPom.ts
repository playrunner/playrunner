import type { Locator, Page } from '@playwright/test';
import type { PlayrunnerE2EHost } from '@playrunner/integration-sdk/e2e';

export class JiraE2EPom {
  readonly authenticateButton: Locator;
  readonly clientIdInput: Locator;
  readonly clientSecretInput: Locator;
  readonly dialog: Locator;
  readonly nodeActionSelect: Locator;
  readonly nodeDescriptionInput: Locator;
  readonly nodeDialog: Locator;
  readonly nodeIssueKeyInput: Locator;
  readonly nodeIssueTypeSelect: Locator;
  readonly nodeProjectSelect: Locator;
  readonly nodeSummaryInput: Locator;
  readonly setupGuideLink: Locator;
  readonly changeCredentialsButton: Locator;

  constructor(
    readonly page: Page,
    private readonly host: PlayrunnerE2EHost,
  ) {
    this.dialog = page.getByRole('dialog', { name: 'Connect to Jira' });
    this.clientIdInput = page.getByTestId('jira-settings-client-id');
    this.clientSecretInput = page.getByTestId('jira-settings-client-secret');
    this.authenticateButton = this.dialog.getByRole('button', {
      name: 'Authenticate',
    });
    this.setupGuideLink = page.getByTestId('jira-settings-guide');
    this.changeCredentialsButton = this.dialog.getByRole('button', {
      name: 'Change Credentials',
    });
    this.nodeDialog = page.getByRole('dialog', { name: 'Jira' });
    this.nodeActionSelect = page.getByTestId('jira-node-action');
    this.nodeDescriptionInput = page.getByTestId('jira-node-description');
    this.nodeIssueKeyInput = page.getByTestId('jira-node-issue-key');
    this.nodeIssueTypeSelect = page.getByTestId('jira-node-issue-type');
    this.nodeProjectSelect = page.getByTestId('jira-node-project');
    this.nodeSummaryInput = page.getByTestId('jira-node-summary');
  }

  async open() {
    await this.host.openIntegration({ id: 'jira', name: 'Jira' });
  }

  async createNode() {
    await this.host.openNewWorkflow();
    await this.host.addNode('jira');
    await this.host.openNodeSettings('jira');
  }

  async closeNode() {
    await this.host.closeNodeSettings();
  }

  async reopenNode() {
    await this.host.openNodeSettings('jira');
  }

  async saveAndReloadWorkflow() {
    await this.host.saveWorkflow();
    await this.host.reloadWorkflow();
  }

  async runWorkflow() {
    return this.host.runWorkflowNode('jira');
  }
}
