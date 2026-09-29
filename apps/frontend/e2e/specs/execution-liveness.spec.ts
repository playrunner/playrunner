import { expect, test } from '../fixtures';
import { executionFixture } from '../support/executionFixture';

test('quiet runs remain visible and completed outcomes recover without a page reload @execution-liveness', async ({
  page,
}) => {
  await page.goto('/projects');
  const userId = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('playrunner.localAuthSession')!).user.uid,
  );
  const fixture = await executionFixture(userId);
  try {
    await fixture.quiet();
    await page.goto('/executions');
    await expect(page.getByText('Live', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Server host health' }),
    ).toBeVisible();
    const run = page.getByRole('region', {
      name: `Execution ${fixture.id}`,
      exact: true,
    });
    await expect(
      page
        .getByRole('region', { name: 'Active runs', exact: true })
        .getByRole('region', { name: `Execution ${fixture.id}`, exact: true }),
    ).toBeVisible();
    await expect(run).toContainText('No recent updates—status unconfirmed');
    await page.screenshot({
      path: 'test-results/execution-liveness-desktop.png',
      fullPage: true,
    });
    await page
      .getByRole('button', { name: 'Collapse Sidebar', exact: true })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(run).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: 'test-results/execution-liveness-mobile.png',
      fullPage: true,
    });
    // Drop only the live transport. Snapshots still use the real API/database.
    await page.route('**/api/executions/live/stream?*', (route) =>
      route.abort(),
    );
    await page.reload();
    await expect(run).toBeVisible();
    await fixture.complete();
    await expect(run).toContainText('462 / 462 tests completed', {
      timeout: 30000,
    });
    await expect(run).toContainText('completed');
    await expect(
      page
        .getByRole('region', { name: 'Active runs', exact: true })
        .getByRole('region', { name: `Execution ${fixture.id}`, exact: true }),
    ).toHaveCount(0);
  } finally {
    await fixture.dispose();
  }
});
