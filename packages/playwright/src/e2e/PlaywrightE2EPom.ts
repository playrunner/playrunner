import type { Locator, Page } from '@playwright/test';
import type { PlayrunnerE2EHost } from '@playrunner/integration-sdk/e2e';

export class PlaywrightE2EPom {
  readonly dialog: Locator;
  constructor(
    readonly page: Page,
    private readonly host: PlayrunnerE2EHost,
  ) {
    this.dialog = page.getByRole('dialog', { name: 'Playwright' });
  }

  integrationCard() {
    return this.page.getByTestId('integration-card-playwright');
  }

  async openCatalog() {
    await this.host.gotoIntegrations();
  }

  field(name: string) {
    return this.page.getByTestId(`playwright-node-${name}`);
  }

  async createNode() {
    await this.host.openNewWorkflow();
    await this.host.addNode('playwright');
    await this.host.openNodeSettings('playwright');
  }

  async saveReloadAndReopenNode() {
    await this.host.closeNodeSettings();
    await this.host.saveWorkflow();
    await this.host.reloadWorkflow();
    await this.host.openNodeSettings('playwright');
  }

  async fillScript(script: string) {
    await this.field('script').locator('.view-lines').click();
    await this.page.keyboard.press('Control+A');
    await this.page.keyboard.insertText(script);
  }

  async dropEnvironmentVariable(variableName: string) {
    await this.field('env-vars').evaluate((element, name) => {
      const transfer = new DataTransfer();
      transfer.setData('text/plain', `process.env.${name}`);
      element.dispatchEvent(
        new DragEvent('drop', { bubbles: true, dataTransfer: transfer }),
      );
    }, variableName);
  }
}
