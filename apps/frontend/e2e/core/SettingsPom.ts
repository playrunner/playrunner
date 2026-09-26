import { expect, type Page } from '@playwright/test';
import { confirmAction } from './NavigationPom';

export class SettingsPom {
  constructor(readonly page: Page) {}
  get tokenDialog() {
    return this.page.getByRole('dialog', { name: 'Create API token' });
  }
  token(name: string) {
    return this.page
      .getByTestId('api-token-row')
      .filter({ has: this.page.getByText(name, { exact: true }) });
  }
  async goto() {
    await this.page.goto('/settings');
  }
  async createToken(name: string, workflow: string) {
    await this.page
      .getByRole('button', { name: 'Create token', exact: true })
      .click();
    await this.tokenDialog
      .getByRole('textbox', { name: 'Token name', exact: true })
      .fill(name);
    await this.tokenDialog
      .getByRole('checkbox', { name: workflow, exact: true })
      .check();
    await this.tokenDialog
      .getByRole('button', { name: 'Create token', exact: true })
      .click();
    await expect(
      this.tokenDialog.getByText('Copy your token now'),
    ).toBeVisible();
    await this.tokenDialog
      .getByRole('button', { name: 'Done', exact: true })
      .click();
  }
  async rotate(name: string) {
    await confirmAction(
      this.page,
      () =>
        this.token(name)
          .getByRole('button', { name: 'Rotate', exact: true })
          .click(),
      'Rotate',
    );
    await expect(
      this.tokenDialog.getByText('Copy your token now'),
    ).toBeVisible();
    await this.tokenDialog
      .getByRole('button', { name: 'Done', exact: true })
      .click();
  }
  async revoke(name: string) {
    await confirmAction(
      this.page,
      () =>
        this.token(name)
          .filter({
            has: this.page.getByRole('button', { name: 'Revoke', exact: true }),
          })
          .getByRole('button', { name: 'Revoke', exact: true })
          .click(),
      'Revoke',
    );
  }
  async passwordForm(current: string, next: string, confirmation: string) {
    await this.page
      .locator('input[autocomplete="current-password"]')
      .fill(current);
    const fields = this.page.locator('input[autocomplete="new-password"]');
    await fields.nth(0).fill(next);
    await fields.nth(1).fill(confirmation);
    await this.page
      .getByRole('button', { name: 'Change Password', exact: true })
      .click();
  }
}
