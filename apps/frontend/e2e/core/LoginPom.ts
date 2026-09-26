import type { Page } from '@playwright/test';

export class LoginPom {
  constructor(readonly page: Page) {}
  async signIn(username: string, password: string) {
    await this.page
      .getByPlaceholder('Username', { exact: true })
      .fill(username);
    await this.page
      .getByPlaceholder('Password', { exact: true })
      .fill(password);
    await this.page.getByRole('button', { name: 'Enter Playrunner' }).click();
  }
}
