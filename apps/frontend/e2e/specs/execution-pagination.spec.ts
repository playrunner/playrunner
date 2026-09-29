import { expect, test } from '../fixtures';
import { executionFixture } from '../support/executionFixture';

test('recent runs paginate beyond thirty while all active runs remain visible @execution-pagination', async ({
  page,
}) => {
  await page.goto('/projects');
  const userId = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('playrunner.localAuthSession')!).user.uid,
  );
  const fixture = await executionFixture(userId);
  try {
    const ids = await fixture.seedHistory(35);
    await fixture.quiet();
    await page.goto('/executions');
    const recent = page.getByRole('region', {
      name: 'Recent runs',
      exact: true,
    });
    const active = page.getByRole('region', {
      name: 'Active runs',
      exact: true,
    });
    const cards = recent.getByRole('region', { name: /^Execution / });
    const activeRun = active.getByRole('region', {
      name: `Execution ${fixture.id}`,
      exact: true,
    });
    const pager = recent.getByRole('navigation', {
      name: 'Recent runs pagination',
    });
    await expect(recent.getByLabel('Runs per page')).toHaveValue('10');
    await expect(cards).toHaveCount(10);
    await expect(pager).toContainText('Page 1 of 4 · 35 runs');
    await expect(
      pager.getByRole('button', { name: 'Previous' }),
    ).toBeDisabled();
    await expect(
      recent.getByRole('region', { name: `Execution ${ids[0]}`, exact: true }),
    ).toBeVisible();
    for (let current = 2; current <= 4; current++) {
      await pager.getByRole('button', { name: 'Next' }).click();
      await expect(cards).toHaveCount(current === 4 ? 5 : 10);
      await expect(pager).toContainText(`Page ${current} of 4 · 35 runs`);
      await expect(activeRun).toBeVisible();
    }
    await expect(pager.getByRole('button', { name: 'Next' })).toBeDisabled();
    await expect(
      recent.getByRole('region', { name: `Execution ${ids[34]}`, exact: true }),
    ).toBeVisible();
    await pager.getByRole('button', { name: 'Previous' }).click();
    await expect(pager).toContainText('Page 3 of 4');
    await expect(cards).toHaveCount(10);
    await recent.getByLabel('Runs per page').selectOption('25');
    await expect(pager).toContainText('Page 1 of 2');
    await expect(cards).toHaveCount(25);
    await recent.getByLabel('Runs per page').selectOption('10');
    await expect(cards).toHaveCount(10);
    await page.screenshot({
      path: 'test-results/execution-pagination-desktop.png',
    });
    await page
      .getByRole('button', { name: 'Collapse Sidebar', exact: true })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await pager.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: 'test-results/execution-pagination-mobile.png',
    });
    await fixture.complete();
    await expect(pager).toContainText('36 runs');
    await expect(cards).toHaveCount(10);
    await expect(activeRun).toHaveCount(0);
  } finally {
    await fixture.dispose();
  }
});
