import { expect, type Page } from '@playwright/test';

export class PageLayoutPom {
  constructor(private readonly page: Page) {}

  async expectHeaderBelowBanner(visible: boolean) {
    const dismiss = this.page.getByRole('button', {
      name: 'Dismiss contributor banner',
    });
    if (visible) await expect(dismiss).toBeVisible();
    else await expect(dismiss).toBeHidden();
    await expect
      .poll(async () => {
        const header = await this.page.getByRole('banner').boundingBox();
        const bannerBottom = visible
          ? await dismiss.evaluate(
              (element) =>
                element.parentElement!.getBoundingClientRect().bottom,
            )
          : 0;
        return Math.abs(header!.y - bannerBottom);
      })
      .toBeLessThanOrEqual(1);
  }

  async expectHeadingBelowHeader() {
    await expect
      .poll(async () => {
        const header = await this.page.getByRole('banner').boundingBox();
        const heading = await this.page
          .getByRole('heading', {
            name: 'Authentication Profiles',
            exact: true,
          })
          .boundingBox();
        return heading!.y - (header!.y + header!.height);
      })
      .toBeGreaterThanOrEqual(0);
  }

  async dismissBanner() {
    await this.page
      .getByRole('button', { name: 'Dismiss contributor banner' })
      .click();
  }
}
