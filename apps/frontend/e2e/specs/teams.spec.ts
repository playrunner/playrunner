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
  const teamCard = page
    .getByTestId('team-card')
    .filter({ has: page.getByRole('heading', { name: teamName }) });
  await expect(teamCard).toBeVisible();
  await expect(
    teamCard.getByText('owner', { exact: true }).first(),
  ).toBeVisible();

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

  const browser = page.context().browser();
  if (!browser) throw new Error('The teams E2E test requires a browser.');
  const invitedContext = await browser.newContext();
  const invitedPage = await invitedContext.newPage();
  await invitedPage.goto(invitationPayload.invitation.invitationPath);
  await expect(invitedPage).toHaveURL(/\/login\?returnTo=/);
  await invitedPage
    .getByRole('link', { name: 'Create an account from this invitation' })
    .click();
  await expect(
    invitedPage.getByRole('heading', { name: 'Create your account' }),
  ).toBeVisible();
  await expect(
    invitedPage.getByText(memberEmail, { exact: true }).first(),
  ).toBeVisible();
  await invitedPage
    .getByLabel('Password', { exact: true })
    .fill('invited-e2e-password');
  await invitedPage.getByLabel('Confirm password').fill('invited-e2e-password');
  await invitedPage
    .getByRole('button', { name: 'Create account and join' })
    .click();

  await expect(invitedPage).toHaveURL('/teams');
  await expect(
    invitedPage.getByRole('heading', { name: teamName }),
  ).toBeVisible();
  await expect(
    invitedPage.getByText('member', { exact: true }).first(),
  ).toBeVisible();
  await invitedContext.close();

  await page.goto('/teams');
  await expect(
    teamCard.getByText(memberEmail, { exact: true }).first(),
  ).toBeVisible();
  await expect(
    teamCard.getByText('Accepted', { exact: true }).first(),
  ).toBeVisible();

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
