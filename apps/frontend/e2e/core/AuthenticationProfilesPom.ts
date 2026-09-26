import { expect, type Page } from '@playwright/test';

export type ProfileData = {
  name: string;
  environment: string;
  application: string;
  role: string;
  startUrl: string;
  successUrl: string;
};
export class AuthenticationProfilesPom {
  constructor(readonly page: Page) {}
  get dialog() {
    return this.page.getByRole('dialog', {
      name: /^(Create|Edit) Authentication Profile$/,
    });
  }
  card(name: string) {
    return this.page
      .getByRole('article')
      .filter({ has: this.page.getByRole('heading', { name, exact: true }) });
  }
  async goto() {
    await this.page.goto('/authentication-profiles');
  }
  async beginCreate() {
    await this.page
      .getByRole('button', { name: 'Create profile', exact: true })
      .click();
  }
  async fill(data: ProfileData) {
    await this.dialog.getByLabel('Name', { exact: true }).fill(data.name);
    await this.dialog
      .getByRole('combobox', { name: 'Environment', exact: true })
      .selectOption({ label: data.environment });
    await this.dialog
      .getByLabel('Application label (optional)')
      .fill(data.application);
    await this.dialog
      .getByLabel('Role / test account (optional)')
      .fill(data.role);
    await this.dialog
      .getByLabel('Start URL', { exact: true })
      .fill(data.startUrl);
    await this.dialog
      .getByLabel('Success URL', { exact: true })
      .fill(data.successUrl);
  }
  async save() {
    await this.dialog.getByRole('button', { name: 'Save profile' }).click();
    await expect(this.dialog).toBeHidden();
  }
  async create(data: ProfileData) {
    await this.beginCreate();
    await this.fill(data);
    await this.save();
  }
  async edit(name: string) {
    await this.card(name)
      .getByRole('button', { name: 'Edit', exact: true })
      .click();
  }
  async delete(name: string, accept = true) {
    await this.card(name)
      .getByRole('button', { name: `Delete ${name}`, exact: true })
      .click();
    const dialog = this.page.getByRole('alertdialog');
    await dialog
      .getByRole('button', {
        name: accept ? 'Delete profile' : 'Cancel',
        exact: true,
      })
      .click();
    await expect(dialog).toBeHidden();
  }
}
