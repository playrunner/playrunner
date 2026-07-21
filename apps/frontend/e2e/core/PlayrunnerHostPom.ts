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
    await this.gotoIntegrations();
    const card = this.integrationCard(id);
    const connectButton = card.getByRole('button', { name: 'Connect' });

    if (await connectButton.isVisible()) {
      await connectButton.click();
    } else {
      await card.getByRole('button', { name: `Configure ${name}` }).click();
    }

    await this.page
      .getByRole('dialog', { name: `Connect to ${name}` })
      .waitFor();
  }
}
