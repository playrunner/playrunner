import type { Locator, Page } from '@playwright/test';
import type { PlayrunnerE2EHost } from '@playrunner/integration-sdk/e2e';

export class JavascriptE2EPom {
  readonly scriptInput: Locator;

  constructor(
    readonly page: Page,
    private readonly host: PlayrunnerE2EHost,
  ) {
    this.scriptInput = page.getByTestId('code-node-script');
  }

  integrationCard() {
    return this.page.getByTestId('integration-card-code');
  }

  async openCatalog() {
    await this.host.gotoIntegrations();
  }

  async createNode() {
    await this.host.openNewWorkflow();
    await this.host.addNode('code');
    await this.host.openNodeSettings('code');
  }

  async closeNode() {
    await this.host.closeNodeSettings();
  }

  async saveReloadAndReopenNode() {
    await this.closeNode();
    await this.host.saveWorkflow();
    await this.host.reloadWorkflow();
    await this.host.openNodeSettings('code');
  }

  async runWorkflow() {
    return this.host.runWorkflowNode('code');
  }
}
