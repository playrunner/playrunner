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
}
