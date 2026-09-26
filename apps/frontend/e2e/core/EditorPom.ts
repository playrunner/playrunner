import { expect, type Page } from '@playwright/test';

export class EditorPom {
  constructor(readonly page: Page) {}

  async ready() {
    await expect(
      this.page.getByRole('progressbar', { name: 'Loading page' }),
    ).toBeHidden();
    await expect(
      this.page.getByText('Loading orchestrator runner...'),
    ).toBeHidden();
    await this.page.getByTitle('Add Node', { exact: true }).waitFor();
    await this.page.getByTitle('View JSON', { exact: true }).waitFor();
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
    await this.ready();
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
    await expect(
      this.page.getByTitle('Stop Simulation', { exact: true }),
    ).toBeHidden({ timeout: 120_000 });
    return (await node.getAttribute('data-node-status')) as 'error' | 'success';
  }

  async rename(name: string) {
    await this.page.getByTitle('Click to rename workflow').click();
    await this.page.getByRole('textbox').fill(name);
    await this.page.getByRole('textbox').press('Enter');
    await expect(this.page.getByTitle('Click to rename workflow')).toHaveText(
      name,
    );
  }

  async definition() {
    await this.page.getByTitle('View JSON', { exact: true }).click();
    const dialog = this.page.getByRole('dialog', { name: 'Workflow JSON' });
    const definition = JSON.parse(await dialog.locator('pre').innerText()) as {
      nodes: Array<{
        id: string;
        nodeType: string;
        label: string;
        config?: Record<string, unknown>;
      }>;
      connections: Array<{ sourceId: string; targetId: string }>;
      cloudProvider: string;
    };
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    return definition;
  }
}
