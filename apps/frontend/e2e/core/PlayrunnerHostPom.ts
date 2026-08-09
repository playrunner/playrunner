import type { Page } from '@playwright/test';
import type { PlayrunnerE2EHost } from '@playrunner/integration-sdk/e2e';

export class PlayrunnerHostPom implements PlayrunnerE2EHost {
  constructor(readonly page: Page) {}

  async openNewWorkflow() {
    await this.page.goto('/projects');
    await this.page
      .getByRole('button', { name: 'New Project' })
      .first()
      .click();
    await this.page
      .getByRole('heading', { name: 'Project Dashboard' })
      .waitFor();
    await this.page.getByText('Default Workflow', { exact: true }).click();
    await this.page.getByTitle('Add Node').waitFor();
  }

  async addNode(nodeType: string) {
    await this.page.getByTitle('Add Node').click();
    await this.page.getByTestId(`node-selector-option-${nodeType}`).click();
    await this.page.getByTestId(`canvas-node-${nodeType}`).last().waitFor();
  }

  async openNodeSettings(nodeType: string) {
    const node = this.page.getByTestId(`canvas-node-${nodeType}`).last();
    const setupButton = node.getByTitle(
      'Node not fully configured. Click to setup.',
    );
    if (await setupButton.isVisible()) {
      await setupButton.click();
    } else {
      await node.click({ button: 'right' });
      await this.page
        .getByRole('button', { name: 'Configure', exact: true })
        .click();
    }
    await this.page.getByRole('dialog').last().waitFor();
  }

  async closeNodeSettings() {
    await this.page.getByRole('dialog').last().getByTitle('Close').click();
  }

  async saveWorkflow() {
    const response = this.page.waitForResponse((candidate) => {
      const url = new URL(candidate.url());
      return (
        candidate.request().method() === 'PUT' &&
        url.pathname.startsWith('/api/store/workflows/')
      );
    });
    await this.page.getByTitle('Save Workflow').click();
    const result = await response;
    if (!result.ok()) {
      throw new Error(`Workflow save failed with ${result.status()}.`);
    }
  }

  async reloadWorkflow() {
    await this.page.reload();
    await this.page.getByTitle('Add Node').waitFor();
  }

  async runWorkflowNode(nodeType: string): Promise<'error' | 'success'> {
    const node = this.page.getByTestId(`canvas-node-${nodeType}`).last();
    await this.page.getByTitle('Play Simulation').click();
    await this.page.waitForFunction(
      (type) => {
        const nodes = document.querySelectorAll(
          `[data-testid="canvas-node-${type}"]`,
        );
        const node = nodes[nodes.length - 1];
        return ['success', 'error'].includes(
          node?.getAttribute('data-node-status') ?? '',
        );
      },
      nodeType,
      { timeout: 120_000 },
    );
    return (await node.getAttribute('data-node-status')) as 'error' | 'success';
  }

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
