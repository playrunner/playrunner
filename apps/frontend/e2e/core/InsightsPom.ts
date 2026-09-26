import { expect, type Page } from '@playwright/test';

export class InsightsPom {
  constructor(readonly page: Page) {}
  async selectRange(label: '7 days' | '30 days' | '90 days' | 'All time') {
    await this.page.getByRole('button', { name: label, exact: true }).click();
    await expect(
      this.page.getByText(
        `${label === 'All time' ? 'All time' : `Last ${label}`} terminal completion rate`,
        { exact: true },
      ),
    ).toBeVisible();
  }
  section(name: string) {
    return this.page
      .locator('section')
      .filter({ has: this.page.getByRole('heading', { name, exact: true }) });
  }
  async refresh() {
    const loaded = this.page.waitForResponse(
      (response) =>
        response.url().includes('/api/insights') &&
        response.request().method() === 'GET',
    );
    await this.page
      .getByRole('button', { name: 'Refresh', exact: true })
      .click();
    expect((await loaded).ok()).toBe(true);
  }
}
