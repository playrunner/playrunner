import crypto from 'node:crypto';
import { test, expect } from '../fixtures';
import { authenticatedApi } from '../support/authenticatedApi';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test('TOTP profile is opt-in, credentials stay write-only, and existing capture is unchanged', async ({
  page,
  profiles,
}, info) => {
  const suffix = `${info.workerIndex}-${Date.now()}`;
  const environmentId = `totp-environment-${suffix}`;
  const credentials = {
    username: crypto.randomUUID(),
    password: crypto.randomBytes(24).toString('hex'),
    secret: Array.from(
      crypto.randomBytes(32),
      (value) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[value % 32],
    ).join(''),
  };
  await page.goto('/projects');
  expect(
    (
      await authenticatedApi(page, `/api/store/environments/${environmentId}`, {
        method: 'PUT',
        body: { name: `TOTP ${suffix}`, variables: [] },
      })
    ).status,
  ).toBe(201);
  await profiles.goto();
  await profiles.beginCreate();
  await expect(
    profiles.dialog.getByRole('button', {
      name: 'Saved browser session',
      exact: true,
    }),
  ).toHaveAttribute('aria-pressed', 'true');
  await profiles.fill({
    name: `TOTP ${suffix}`,
    environment: `TOTP ${suffix}`,
    application: 'Controlled MFA provider',
    role: 'Automation',
    startUrl: 'http://127.0.0.1:4013/login',
    successUrl: 'http://127.0.0.1:4013/app',
  });
  await profiles.dialog
    .getByRole('button', { name: 'Username, password + TOTP', exact: true })
    .click();
  await expect(
    profiles.dialog.getByLabel('Start URL', { exact: true }),
  ).toHaveValue('http://127.0.0.1:4013/login');
  await expect(
    profiles.dialog.getByLabel('Allowed sign-in origins (comma separated)'),
  ).toHaveValue('');
  await expect(
    profiles.dialog.getByRole('button', { name: /^Use .* form$/ }),
  ).toHaveCount(0);
  await profiles.configureTotp(credentials, 'http://127.0.0.1:4013');
  await profiles.save();
  await expect(profiles.card(`TOTP ${suffix}`)).toContainText(
    'TOTP configured',
  );
  const list = await authenticatedApi(page, '/api/authentication-profiles');
  const responseText = JSON.stringify(list.payload);
  expect(
    Object.values(credentials).some((value) => responseText.includes(value)),
    'No account input or seed is returned',
  ).toBe(false);
  const profile = (
    list.payload as { profiles: Array<{ id: string; name: string }> }
  ).profiles.find((value) => value.name === `TOTP ${suffix}`)!;
  await profiles.edit(`TOTP ${suffix}`);
  for (const label of ['Username', 'Password', 'TOTP setup secret'])
    await expect(
      profiles.dialog.getByLabel(label, { exact: true }),
    ).toHaveValue('');
  await profiles.save();
  await expect(profiles.card(`TOTP ${suffix}`)).toContainText(
    'TOTP configured',
  );
  const revoked = await authenticatedApi(
    page,
    `/api/authentication-profiles/${profile.id}/revoke`,
    { method: 'POST' },
  );
  expect(revoked.status).toBe(200);
  expect(
    (
      revoked.payload as {
        profile: { credentialStatus: { configured: boolean }; status: string };
      }
    ).profile,
  ).toMatchObject({
    status: 'revoked',
    credentialStatus: { configured: false },
  });
  const invalid = await authenticatedApi(
    page,
    `/api/authentication-profiles/${profile.id}`,
    {
      method: 'PUT',
      body: { totpCredentials: { username: credentials.username } },
    },
  );
  expect(invalid.status).toBe(400);
  expect(JSON.stringify(invalid.payload).includes(credentials.username)).toBe(
    false,
  );
  await profiles.goto();
  await profiles.delete(`TOTP ${suffix}`);
  await authenticatedApi(page, `/api/store/environments/${environmentId}`, {
    method: 'DELETE',
  });
});
