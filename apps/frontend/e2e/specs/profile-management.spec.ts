import { expect, test } from '../fixtures';

test.describe('Authentication Profile management @workspace @profiles', () => {
  test('requires an environment before saving a profile', async ({
    profiles,
    page,
  }) => {
    await profiles.goto();
    await expect(
      page.getByRole('button', { name: 'Create profile', exact: true }),
    ).toBeDisabled();
    await page
      .getByRole('button', { name: 'Open Environments', exact: true })
      .click();
    await expect(page).toHaveURL('/environments');
  });

  test('creates, edits, reloads and deletes an unauthenticated profile', async ({
    page,
    environments,
    profiles,
    navigation,
    data,
  }) => {
    await environments.goto();
    await environments.create(data.environment);
    await navigation.open('Authentication Profiles');
    await profiles.create({
      name: data.profile,
      environment: data.environment,
      application: 'Demo app',
      role: 'Tester',
      startUrl: 'http://127.0.0.1:4013/login',
      successUrl: 'http://127.0.0.1:4013/app',
    });
    await expect(profiles.card(data.profile)).toContainText(
      'Not authenticated',
    );
    await expect(
      profiles.card(data.profile).getByRole('button', { name: 'Test session' }),
    ).toBeDisabled();
    await expect(profiles.card(data.profile)).toContainText(data.environment);
    await page.reload();
    await profiles.edit(data.profile);
    await expect(
      profiles.dialog.getByLabel('Start URL', { exact: true }),
    ).toHaveValue('http://127.0.0.1:4013/login');
    await profiles.dialog
      .getByLabel('Name', { exact: true })
      .fill(`${data.profile} edited`);
    await profiles.dialog
      .getByRole('combobox', {
        name: 'Authentication success condition',
        exact: true,
      })
      .selectOption('element_visible');
    await profiles.dialog
      .getByLabel('Selector', { exact: true })
      .fill('[data-testid="authenticated-app"]');
    await profiles.save();
    await page.reload();
    await profiles.edit(`${data.profile} edited`);
    await expect(
      profiles.dialog.getByLabel('Selector', { exact: true }),
    ).toHaveValue('[data-testid="authenticated-app"]');
    await profiles.dialog.getByRole('button', { name: 'Cancel' }).click();
    await profiles.delete(`${data.profile} edited`, false);
    await expect(profiles.card(`${data.profile} edited`)).toBeVisible();
    await profiles.delete(`${data.profile} edited`);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'No Authentication Profiles yet' }),
    ).toBeVisible();
  });
});
