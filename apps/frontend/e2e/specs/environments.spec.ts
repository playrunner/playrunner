import { expect, test } from '../fixtures';
import { confirmAction } from '../core/NavigationPom';

test.describe('Reusable environments @workspace @environments', () => {
  test('creates and edits variables, persists changes, and confirms deletion', async ({
    page,
    environments,
    data,
  }) => {
    await environments.goto();
    await expect(
      page.getByText('No environments configured yet.'),
    ).toBeVisible();
    await environments.beginCreate();
    await expect(
      environments.dialog.getByRole('button', { name: 'Create Environment' }),
    ).toBeDisabled();
    await environments.name.fill(data.environment);
    await environments.description.fill('Reusable browser test values');
    await environments.variable(1, 'name').fill('BASE_URL');
    await environments
      .variable(1, 'initial value')
      .fill('http://127.0.0.1:4013');
    await environments
      .variable(1, 'current value')
      .fill('http://127.0.0.1:4013/app');
    await environments.save();
    await page.reload();
    await environments.edit(data.environment);
    await expect(environments.variable(1, 'initial value')).toHaveValue(
      'http://127.0.0.1:4013',
    );
    await expect(environments.variable(1, 'current value')).toHaveValue(
      'http://127.0.0.1:4013/app',
    );
    await environments.variable(2, 'name').fill('BROWSER');
    await environments.variable(2, 'initial value').fill('chromium');
    await environments.save();
    await expect(environments.card(data.environment)).toContainText(
      '2 variables',
    );
    await environments.edit(data.environment);
    await environments.dialog
      .getByRole('button', { name: 'Delete variable 1', exact: true })
      .click();
    await environments.name.fill(`${data.environment} renamed`);
    await environments.save();
    await page.reload();
    await environments.edit(`${data.environment} renamed`);
    await expect(environments.variable(1, 'name')).toHaveValue('BROWSER');
    await expect(environments.variable(1, 'initial value')).toHaveValue(
      'chromium',
    );
    await environments.dialog.getByRole('button', { name: 'Cancel' }).click();
    await environments.delete(`${data.environment} renamed`, false);
    await expect(
      environments.card(`${data.environment} renamed`),
    ).toBeVisible();
    await environments.delete(`${data.environment} renamed`);
    await page.reload();
    await expect(
      page.getByText('No environments configured yet.'),
    ).toBeVisible();
  });

  test('rejects duplicate names and discards cancelled edits', async ({
    page,
    environments,
    data,
  }) => {
    await environments.goto();
    await environments.create(data.environment, 'Original description');
    await environments.beginCreate();
    await environments.name.fill(data.environment.toUpperCase());
    await confirmAction(
      page,
      () =>
        environments.dialog
          .getByRole('button', { name: 'Create Environment' })
          .click(),
      'already exists',
    );
    await expect(environments.dialog).toBeVisible();
    await environments.dialog.getByRole('button', { name: 'Cancel' }).click();
    await environments.edit(data.environment);
    await environments.description.fill('Unsaved');
    await environments.dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.reload();
    await expect(page.getByTestId('environment-card')).toHaveCount(1);
    await environments.edit(data.environment);
    await expect(environments.description).toHaveValue('Original description');
  });
});
