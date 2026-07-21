import type { Page } from '@playwright/test';
import type { PlayrunnerE2EHost } from '@playrunner/integration-sdk/e2e';

export class JavascriptE2EPom {
  constructor(
    readonly page: Page,
    private readonly host: PlayrunnerE2EHost,
  ) {}

  integrationCard() {
    return this.page.getByTestId('integration-card-code');
  }

  async openCatalog() {
    await this.host.gotoIntegrations();
  }
}
