import { expect, test } from '../fixtures';

test('searches and selects multiple values in the design system control @design', async ({
  page,
}) => {
  await page.goto('/design');

  const multiSelect = page.getByRole('combobox', {
    name: 'Supported browsers',
  });
  await expect(multiSelect).toContainText('Chrome');
  await multiSelect.click();

  await page.getByRole('searchbox', { name: 'Search browsers' }).fill('Safari');
  await expect(page.getByRole('option', { name: 'Safari' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Firefox' })).not.toBeVisible();
  await page.getByRole('option', { name: 'Safari' }).click();

  await expect(multiSelect).toContainText('2 selected');
});
