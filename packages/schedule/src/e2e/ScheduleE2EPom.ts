import type { Locator, Page } from '@playwright/test';
import type { PlayrunnerE2EHost } from '@playrunner/integration-sdk/e2e';

export class ScheduleE2EPom {
  readonly card: Locator;

  constructor(
    readonly page: Page,
    private readonly host: PlayrunnerE2EHost,
  ) {
    this.card = page.getByTestId('integration-card-schedule');
  }

  async openCatalog() {
    await this.host.gotoIntegrations();
  }

  field(name: string) {
    return this.page.getByTestId(`schedule-node-${name}`);
  }

  async createNodeWithGcpRunner() {
    await this.host.openNewWorkflow();
    await this.page.getByTestId('workflow-runner-selector').click();
    await this.page.getByTestId('workflow-runner-option-GCP').click();
    const gcpDialog = this.page.getByRole('dialog', { name: 'Connect to GCP' });
    await gcpDialog.waitFor();
    const closeButton = gcpDialog.getByRole('button', {
      name: 'Close',
      exact: true,
    });
    if (await closeButton.isVisible()) await closeButton.click();
    else await gcpDialog.getByTitle('Close').click();
    await this.host.addNode('schedule');
    await this.host.openNodeSettings('schedule');
  }

  async saveReloadAndReopenNode() {
    await this.host.closeNodeSettings();
    await this.host.saveWorkflow();
    await this.host.reloadWorkflow();
    await this.host.openNodeSettings('schedule');
  }
}
