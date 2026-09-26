import { expect, test } from '@playwright/test';
import { LoginPom } from '../core/LoginPom';
import { NavigationPom } from '../core/NavigationPom';

test('protects private routes, rejects invalid login, returns to the requested page and logs out @workspace @auth', async ({
  page,
}) => {
  const login = new LoginPom(page);
  const navigation = new NavigationPom(page);
  await page.goto('/environments');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fenvironments/);
  await login.signIn('e2e@playrunner.dev', 'incorrect-password');
  await expect(
    page.getByRole('heading', { name: 'Sign in to your account' }),
  ).toBeVisible();
  await expect(page.getByText(/invalid|incorrect/i)).toBeVisible();
  await login.signIn('e2e@playrunner.dev', 'playrunner-e2e-password');
  await expect(page).toHaveURL('/environments');
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Environments', exact: true }),
  ).toBeVisible();
  await navigation.account('Log out');
  await expect(
    page.getByRole('heading', { name: 'Sign in to your account' }),
  ).toBeVisible();
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fsettings/);
});
