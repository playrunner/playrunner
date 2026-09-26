import { expect, type Page } from '@playwright/test';
import { confirmAction } from './NavigationPom';

export class ProjectsPom {
  constructor(readonly page: Page) {}

  get createDialog() {
    return this.page.getByRole('dialog', {
      name: 'Create project',
      exact: true,
    });
  }
  get settingsDialog() {
    return this.page.getByRole('dialog', {
      name: 'Project settings',
      exact: true,
    });
  }
  project(name: string) {
    return this.page
      .getByTestId('project-card')
      .filter({ has: this.page.getByRole('heading', { name, exact: true }) });
  }
  workflow(name: string) {
    return this.page.getByTestId('workflow-card').filter({
      has: this.page.getByRole('heading', { name, level: 3, exact: true }),
    });
  }

  async goto() {
    await this.page.goto('/projects');
  }
  async beginCreate() {
    await this.page
      .getByRole('button', { name: 'New Project', exact: true })
      .first()
      .click();
  }
  async create(name: string, startingNodes?: string[]) {
    await this.beginCreate();
    await this.createDialog
      .getByRole('textbox', { name: 'Project name' })
      .fill(name);
    if (startingNodes) {
      while (await this.createDialog.getByRole('combobox').count()) {
        await this.createDialog
          .getByRole('button', { name: 'Remove starting node 1', exact: true })
          .click();
      }
      for (const [index, nodeType] of startingNodes.entries()) {
        await this.createDialog
          .getByRole('button', { name: 'Add starting node', exact: true })
          .click();
        await this.createDialog
          .getByRole('combobox', {
            name: `Starting node ${index + 1}`,
            exact: true,
          })
          .selectOption(nodeType);
      }
    }
    await this.createDialog
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    await expect(
      this.page.getByRole('heading', { name: 'Project Dashboard' }),
    ).toBeVisible();
    await expect(this.workflow(name)).toBeVisible();
  }
  async settings() {
    await this.page
      .getByRole('button', { name: 'Settings', exact: true })
      .click();
  }
  async saveSettings() {
    await this.settingsDialog
      .getByRole('button', { name: 'Save changes', exact: true })
      .click();
    await expect(this.settingsDialog).toBeHidden();
  }
  async renameProject(name: string) {
    await this.page.getByRole('button', { name: 'Rename project' }).click();
    await this.page.getByRole('textbox').fill(name);
    await this.page.getByRole('textbox').press('Enter');
    await expect(
      this.page.getByRole('heading', { name, level: 1, exact: true }),
    ).toBeVisible();
  }
  async renameWorkflow(oldName: string, name: string) {
    await this.workflow(oldName)
      .getByRole('button', { name: 'More options' })
      .click();
    await this.page
      .getByRole('button', { name: 'Rename', exact: true })
      .click();
    const dialog = this.page.getByRole('dialog', { name: 'Rename workflow' });
    await dialog.getByRole('textbox', { name: 'Workflow name' }).fill(name);
    await dialog
      .getByRole('button', { name: 'Rename workflow', exact: true })
      .click();
    await expect(dialog).toBeHidden();
  }
  async deleteWorkflow(name: string, accept = true) {
    await this.workflow(name)
      .getByRole('button', { name: 'More options' })
      .click();
    await confirmAction(
      this.page,
      () =>
        this.page.getByRole('button', { name: 'Delete', exact: true }).click(),
      'delete this workflow',
      accept,
    );
  }
  async deleteProject(name: string, accept = true) {
    await this.project(name)
      .getByRole('button', { name: `Project options for ${name}` })
      .click();
    await confirmAction(
      this.page,
      () =>
        this.page.getByRole('button', { name: 'Delete', exact: true }).click(),
      'delete this project',
      accept,
    );
    if (accept) await expect(this.project(name)).toBeHidden();
  }
}
