import { expect, type Page } from '@playwright/test';
import { confirmAction } from './NavigationPom';

export class EnvironmentsPom {
  constructor(readonly page: Page) {}
  get dialog() {
    return this.page.getByRole('dialog', { name: /^(New|Edit) Environment$/ });
  }
  get name() {
    return this.dialog.getByPlaceholder('Production, Staging, QA...');
  }
  get description() {
    return this.dialog.getByPlaceholder('Optional description');
  }
  card(name: string) {
    return this.page
      .getByTestId('environment-card')
      .filter({ has: this.page.getByRole('heading', { name, exact: true }) });
  }
  variable(
    index: number,
    field: 'name' | 'initial value' | 'current value' | 'type',
  ) {
    return this.dialog.getByLabel(`Variable ${index} ${field}`, {
      exact: true,
    });
  }
  async goto() {
    await this.page.goto('/environments');
  }
  async beginCreate() {
    await this.page
      .getByRole('button', { name: 'New Environment', exact: true })
      .click();
  }
  async create(name: string, description = '') {
    await this.beginCreate();
    await this.name.fill(name);
    await this.description.fill(description);
    await this.save();
  }
  async edit(name: string) {
    await this.card(name).getByRole('heading', { name, exact: true }).click();
  }
  async save() {
    await this.dialog
      .getByRole('button', { name: /^(Create Environment|Save Changes)$/ })
      .click();
    await expect(this.dialog).toBeHidden();
  }
  async delete(name: string, accept = true) {
    await this.card(name)
      .getByRole('button', { name: `Environment options for ${name}` })
      .click();
    await confirmAction(
      this.page,
      () =>
        this.page.getByRole('button', { name: 'Delete', exact: true }).click(),
      'delete this environment',
      accept,
    );
    if (accept) await expect(this.card(name)).toBeHidden();
  }
}
