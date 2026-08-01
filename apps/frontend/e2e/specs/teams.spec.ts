import { expect, test } from '../fixtures';

test('creates a team and securely manages an invited member @teams', async ({
  page,
}, testInfo) => {
  const suffix = `${testInfo.workerIndex}-${testInfo.retry}`;
  const teamName = `E2E Collaboration ${suffix}`;
  const memberEmail = `member-${suffix}@playrunner.dev`;

  await page.goto('/teams');
  await page.getByLabel('Team name').fill(teamName);
  await page.getByRole('button', { name: 'Create team' }).click();
  await expect(page.getByRole('heading', { name: teamName })).toBeVisible();
  await expect(page.getByText('owner', { exact: true })).toBeVisible();

  const invitationResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/teams\/[^/]+\/invitations$/.test(
        new URL(response.url()).pathname,
      ),
  );
  await page.getByLabel('Email address').fill(memberEmail);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  const invitationPayload = (await (await invitationResponse).json()) as {
    invitation: { invitationPath: string };
  };
  await expect(page.getByText(memberEmail, { exact: true })).toBeVisible();
  await expect(page.getByText('Pending', { exact: true })).toBeVisible();

  await page.getByLabel('Email address').fill(memberEmail.toUpperCase());
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'A pending invitation already exists',
  );

  await page.goto(invitationPayload.invitation.invitationPath);
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await page
    .getByRole('link', { name: 'Create an account from this invitation' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Create your account' }),
  ).toBeVisible();
  await expect(
    page.getByText(memberEmail, { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByLabel('Password', { exact: true })
    .fill('invited-e2e-password');
  await page.getByLabel('Confirm password').fill('invited-e2e-password');
  await page.getByRole('button', { name: 'Create account and join' }).click();

  await expect(page).toHaveURL('/teams');
  await expect(page.getByRole('heading', { name: teamName })).toBeVisible();
  await expect(page.getByText('member', { exact: true }).first()).toBeVisible();

  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/login');
  await page.getByPlaceholder('Username').fill('e2e@playrunner.dev');
  await page.getByPlaceholder('Password').fill('playrunner-e2e-password');
  await page.getByRole('button', { name: 'Enter Playrunner' }).click();
  await page.goto('/teams');
  await expect(page.getByText(memberEmail, { exact: true })).toBeVisible();
  await expect(page.getByText('Accepted', { exact: true })).toBeVisible();

  const pendingEmail = `pending-${suffix}@playrunner.dev`;
  await page.getByLabel('Email address').fill(pendingEmail);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText(pendingEmail, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resend' }).click();
  await expect(
    page.getByRole('heading', { name: 'Invitation ready' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByText('Revoked', { exact: true })).toBeVisible();
});
