import { expect, test } from '../fixtures';
import { ExecutionsPom } from '../core/ExecutionsPom';
import { executionFixture } from '../support/executionFixture';

test('collapsed nodes retain live shard progress and expand into child processes @execution-hierarchy', async ({
  page,
  context,
}) => {
  await page.goto('/projects');
  const userId = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('playrunner.localAuthSession')!).user.uid,
  );
  const fixture = await executionFixture(userId);
  const dashboard = new ExecutionsPom(page);
  try {
    await dashboard.open();
    const parent = dashboard.node(fixture.id, '462 database fixture cases');
    const children = parent.getByRole('list', {
      name: '462 database fixture cases child processes',
      includeHidden: true,
    });
    await expect(parent).toContainText('100 / 462 tests completed · 21%');
    await expect(children).toBeHidden();
    await expect(
      dashboard
        .node(fixture.id, 'Preparing environment')
        .getByRole('progressbar', { name: 'Node in progress' }),
    ).toBeVisible();
    await dashboard.toggle(fixture.id, '462 database fixture cases', true);
    await expect(children).toBeVisible();
    await expect(children.getByRole('listitem')).toHaveCount(4);
    await expect(dashboard.node(fixture.id, 'shard-one')).toContainText(
      '53 / 236 tests completed',
    );
    await fixture.progress('shard-one', 236, 60);
    await expect(parent).toContainText('107 / 462 tests completed');
    await expect(children).toBeVisible();
    await dashboard.toggle(fixture.id, '462 database fixture cases', false);
    await fixture.progress('shard-two', 226, 50);
    await expect(parent).toContainText('110 / 462 tests completed');
    await expect(children).toBeHidden();
    await context.setOffline(true);
    await expect(page.getByText('Reconnecting', { exact: true })).toBeVisible({
      timeout: 20000,
    });
    await expect(parent).toContainText('Last reported');
    await context.setOffline(false);
    await expect(page.getByText('Live', { exact: true })).toBeVisible();
    await expect(children).toBeHidden();
    await page
      .getByRole('button', { name: 'Collapse Sidebar', exact: true })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
    await dashboard.toggle(fixture.id, '462 database fixture cases', true);
    await expect(children).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: 'test-results/execution-hierarchy-mobile.png',
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: 'test-results/execution-hierarchy-desktop.png',
      fullPage: true,
    });
  } finally {
    await fixture.dispose();
    await context.setOffline(false).catch(() => {});
  }
});
