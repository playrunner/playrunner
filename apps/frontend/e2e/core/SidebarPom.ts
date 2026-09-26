import { expect, type Page } from '@playwright/test';

export class SidebarPom {
  constructor(readonly page: Page) {}

  async expectAccountVisible() {
    const account = this.page.getByTitle('User Menu', { exact: true });
    await expect(account).toBeInViewport({ ratio: 1 });
    await expect(account.locator('svg').first()).toBeVisible();
    return account;
  }

  async openAccountMenu() {
    await (await this.expectAccountVisible()).click();
    for (const name of ['Settings', 'Teams', 'Log out']) {
      await expect(
        this.page.getByRole('button', { name, exact: true }),
      ).toBeInViewport({ ratio: 1 });
    }
  }
}
