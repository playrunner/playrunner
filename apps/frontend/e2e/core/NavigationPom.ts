import { expect, type Page } from '@playwright/test';

export class NavigationPom {
  constructor(readonly page: Page) {}

  async open(
    name:
      | 'Projects'
      | 'Environments'
      | 'Authentication Profiles'
      | 'Integrations'
      | 'Insights',
  ) {
    await this.page.getByRole('button', { name, exact: true }).click();
    await expect(
      this.page.getByRole('progressbar', { name: 'Loading page' }),
    ).toBeHidden();
  }

  async account(name: 'Settings' | 'Teams' | 'Log out') {
    await this.page.getByTitle('User Menu').click();
    await this.page
      .getByTestId('account-menu')
      .getByRole('button', { name, exact: true })
      .click();
  }
}

export async function confirmAction(
  page: Page,
  action: () => Promise<void>,
  message: string,
  accept = true,
) {
  const handled = page.waitForEvent('dialog').then(async (dialog) => {
    if (!dialog.message().includes(message)) {
      await dialog.dismiss();
      throw new Error(`Unexpected confirmation: ${dialog.message()}`);
    }
    if (accept) await dialog.accept();
    else await dialog.dismiss();
  });
  await action();
  await handled;
}
