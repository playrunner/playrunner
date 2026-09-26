import { EditorPom } from './EditorPom';
import { randomUUID } from 'node:crypto';
import { ProjectsPom } from './ProjectsPom';
import type { Page } from '@playwright/test';
import type { PlayrunnerE2EHost } from '@playrunner/integration-sdk/e2e';

export class PlayrunnerHostPom implements PlayrunnerE2EHost {
  readonly editor: EditorPom;
  constructor(readonly page: Page) {
    this.editor = new EditorPom(page);
  }

  async openNewWorkflow() {
    const projects = new ProjectsPom(this.page);
    const name = `E2E Workflow ${randomUUID().slice(0, 8)}`;
    await projects.goto();
    await projects.create(name, []);
    await projects
      .workflow(name)
      .getByRole('heading', { name, exact: true })
      .click();
    await this.editor.ready();
  }

  async addNode(nodeType: string) {
    await this.editor.addNode(nodeType);
  }
  async openNodeSettings(nodeType: string) {
    await this.editor.openNodeSettings(nodeType);
  }
  async closeNodeSettings() {
    await this.editor.closeNodeSettings();
  }
  async saveWorkflow() {
    await this.editor.saveWorkflow();
  }
  async reloadWorkflow() {
    await this.editor.reloadWorkflow();
  }
  async runWorkflowNode(nodeType: string) {
    return this.editor.runWorkflowNode(nodeType);
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
