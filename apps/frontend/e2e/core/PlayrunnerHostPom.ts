import type { Page } from '@playwright/test';
import type { PlayrunnerE2EHost } from '@playrunner/integration-sdk/e2e';

export class PlayrunnerHostPom implements PlayrunnerE2EHost {
  constructor(readonly page: Page) {}

  integrationCard(id: string) {
    return this.page.getByTestId(`integration-card-${id}`);
  }

  async gotoIntegrations() {
    await this.page.goto('/integrations');
    await this.page
      .getByRole('heading', { name: 'Connected Integrations' })
      .waitFor();
  }

  async openIntegration({ id, name }: { id: string; name: string }) {
    const connectionResponse = this.page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === 'GET' &&
        url.pathname === `/api/store/integrations/${id}`
      );
    });
    await this.gotoIntegrations();
    const response = await connectionResponse;
    const payload = (await response.json()) as { integration?: unknown };
    const card = this.integrationCard(id);
    const button = payload.integration
      ? card.getByRole('button', { name: `Configure ${name}` })
      : card.getByRole('button', { name: 'Connect' });

    await button.click();

    await this.page
      .getByRole('dialog', { name: `Connect to ${name}` })
      .waitFor();
  }
}
