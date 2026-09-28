import { test } from '../fixtures';
import { PageLayoutPom } from '../core/PageLayoutPom';

// Resize the same mounted layout so ResizeObserver must handle banner wrapping.
test('page header stays below the visible, wrapped and dismissed contributor banner @layout', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/authentication-profiles');
  const layout = new PageLayoutPom(page);
  await layout.expectHeaderBelowBanner(true);
  await layout.expectHeadingBelowHeader();
  await page.getByTitle('Collapse Sidebar', { exact: true }).click();
  await page.setViewportSize({ width: 390, height: 640 });
  await layout.expectHeaderBelowBanner(true);
  await layout.expectHeadingBelowHeader();
  await layout.dismissBanner();
  await layout.expectHeaderBelowBanner(false);
  await layout.expectHeadingBelowHeader();
  await page.setViewportSize({ width: 1280, height: 720 });
  await layout.expectHeaderBelowBanner(false);
  await layout.expectHeadingBelowHeader();
});
