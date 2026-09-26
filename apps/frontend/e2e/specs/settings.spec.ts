import { expect, test } from '../fixtures';

test('creates a workflow-scoped API token, rotates it and revokes access @workspace @settings', async ({
  page,
  projects,
  navigation,
  settings,
  data,
}) => {
  await projects.goto();
  await projects.create(data.project);
  await navigation.account('Settings');
  await expect(
    page.getByText('e2e@playrunner.dev', { exact: true }),
  ).toBeVisible();
  await settings.createToken(data.token, data.project);
  await expect(settings.token(data.token)).toContainText(
    '1 selected workflow(s)',
  );
  await page.reload();
  await expect(settings.token(data.token)).toContainText('Active');
  await expect(page.getByText('Copy your token now')).toHaveCount(0);
  await settings.rotate(data.token);
  await expect(settings.token(data.token)).toHaveCount(2);
  await expect(
    settings.token(data.token).filter({ hasText: 'Revoked' }),
  ).toHaveCount(1);
  await settings.revoke(data.token);
  await page.reload();
  await expect(
    settings.token(data.token).filter({ hasText: 'Revoked' }),
  ).toHaveCount(2);
  await expect(
    settings
      .token(data.token)
      .getByRole('button', { name: 'Revoke', exact: true }),
  ).toHaveCount(0);
});

test('validates password input without changing the account password @workspace @settings', async ({
  page,
  settings,
}) => {
  await settings.goto();
  await page.getByRole('link', { name: 'Change Password' }).click();
  await settings.passwordForm('', '', '');
  await expect(
    page.getByText('Current password and new password are required.'),
  ).toBeVisible();
  await settings.passwordForm('incorrect-password', 'short', 'short');
  await expect(
    page.getByText('New password must be at least 8 characters.'),
  ).toBeVisible();
  await settings.passwordForm(
    'incorrect-password',
    'new-test-password',
    'mismatched-password',
  );
  await expect(
    page.getByText('Password confirmation does not match.'),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Profile', exact: true }),
  ).toBeVisible();
});
