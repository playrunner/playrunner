import { expect, test } from '../fixtures';
import { SidebarPom } from '../core/SidebarPom';

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1280, height: 480 },
  { width: 390, height: 640 },
]) {
  test(`account menu stays accessible at ${viewport.width}x${viewport.height} @sidebar`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/projects');
    const sidebar = new SidebarPom(page);
    const account = await sidebar.expectAccountVisible();
    await expect(account).toContainText('e2e');
    await sidebar.openAccountMenu();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);

    await page.getByTitle('Collapse Sidebar', { exact: true }).click();
    await sidebar.openAccountMenu();
    await page.getByRole('button', { name: 'Teams', exact: true }).click();
    await expect(page).toHaveURL(/\/teams$/);

    await page
      .getByRole('button', { name: 'Dismiss contributor banner' })
      .click();
    await sidebar.openAccountMenu();
    await page.getByRole('button', { name: 'Log out', exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
  });
}

test('account menu stays accessible on long pages and in the editor @sidebar', async ({
  page,
  host,
}) => {
  await page.setViewportSize({ width: 1280, height: 480 });
  await page.goto('/settings');
  const sidebar = new SidebarPom(page);
  await sidebar.expectAccountVisible();
  await page
    .getByRole('link', { name: 'Change password' })
    .scrollIntoViewIfNeeded();
  await sidebar.expectAccountVisible();
  await host.openNewWorkflow();
  await sidebar.openAccountMenu();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
});
