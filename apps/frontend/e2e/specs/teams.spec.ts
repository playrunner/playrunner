import { expect, test } from '../fixtures';
import { authenticatedApi } from '../support/authenticatedApi';

test('creates a team and securely manages an invited member @teams', async ({
  page,
  projects,
  teams,
  data,
  guestPage: invitedPage,
}) => {
  const suffix = data.memberEmail.split('@')[0];
  const teamName = `E2E Collaboration ${suffix}`;
  const memberEmail = `member-${suffix}@playrunner.dev`;

  await projects.goto();
  await projects.create('Default Workflow');
  const ownedWorkflows = await authenticatedApi(page, '/api/store/workflows');
  const ownerWorkflow = (
    ownedWorkflows.payload as {
      workflows: Array<{ id: string; nodes: Array<Record<string, unknown>> }>;
    }
  ).workflows[0];
  expect(ownerWorkflow?.id).toBeTruthy();
  const environmentId = `team-environment-${suffix}`;
  expect(
    (
      await authenticatedApi(page, `/api/store/environments/${environmentId}`, {
        method: 'PUT',
        body: {
          name: 'Team environment',
          variables: [
            { key: 'TEAM_URL', type: 'default', value: 'owner-value' },
          ],
        },
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await authenticatedApi(page, `/api/store/workflows/${ownerWorkflow.id}`, {
        method: 'PUT',
        body: {
          nodes: ownerWorkflow.nodes.map((node) =>
            node.nodeType === 'environment'
              ? {
                  ...node,
                  config: {
                    environmentId,
                    variables: [
                      { key: 'STALE', type: 'default', value: 'stale' },
                    ],
                  },
                }
              : node,
          ),
        },
      })
    ).status,
  ).toBe(200);

  await teams.goto();
  await teams.create(teamName);
  const teamCard = page
    .getByTestId('team-details')
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

  const beforeShare = await authenticatedApi(
    invitedPage,
    '/api/store/workflows?sharedOnly=true',
  );
  expect(beforeShare.status).toBe(200);
  expect(beforeShare.payload).toEqual({ workflows: [] });

  await teams.goto();
  await teams.open(teamName);
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

  await teamCard
    .getByRole('combobox', { name: `Workflows shared with ${teamName}` })
    .click();
  await expect(teamCard.getByRole('listbox')).toBeVisible();
  expect(
    await teamCard.getByRole('listbox').evaluate((listbox) => {
      const card = listbox.closest('[data-testid="team-details"]');
      return (
        card !== null &&
        listbox.getBoundingClientRect().bottom <=
          card.getBoundingClientRect().bottom + 1
      );
    }),
  ).toBe(true);
  await teamCard
    .getByRole('searchbox', { name: 'Search workflows' })
    .fill('Default');
  await teamCard.getByRole('option', { name: 'Default Workflow' }).click();
  await expect(
    teamCard.getByRole('button', { name: /Default Workflow/ }),
  ).toBeVisible();

  await invitedPage.goto('/projects');
  await expect(
    invitedPage.getByRole('heading', { name: 'Shared with your teams' }),
  ).toBeVisible();
  const sharedCard = invitedPage.getByRole('button', {
    name: /Default Workflow/,
  });
  await expect(sharedCard).toContainText(teamName);

  const shared = await authenticatedApi(
    invitedPage,
    '/api/store/workflows?sharedOnly=true',
  );
  expect(shared.status).toBe(200);
  const sharedWorkflow = (
    shared.payload as { workflows: Array<{ id: string }> }
  ).workflows[0];
  expect(sharedWorkflow?.id).toBeTruthy();

  const forbiddenEdit = await authenticatedApi(
    invitedPage,
    `/api/store/workflows/${sharedWorkflow.id}`,
    { method: 'PUT', body: { title: 'Unauthorized rename' } },
  );
  expect(forbiddenEdit.status).toBe(403);

  const started = await authenticatedApi(invitedPage, '/api/workflows/start', {
    method: 'POST',
    body: {
      cloudProvider: 'GCP',
      connections: [],
      nodes: [],
      workflowId: sharedWorkflow.id,
    },
  });
  expect(started.status).toBe(200);
  expect((started.payload as { testId?: string } | null)?.testId).toBeTruthy();

  page.once('dialog', (dialog) => dialog.accept());
  await teamCard.getByRole('button', { name: 'Delete team' }).click();
  await expect(teamCard).not.toBeVisible();

  const revokedList = await authenticatedApi(
    invitedPage,
    '/api/store/workflows?sharedOnly=true',
  );
  expect(revokedList).toEqual({ payload: { workflows: [] }, status: 200 });
  const revokedWorkflow = await authenticatedApi(
    invitedPage,
    `/api/store/workflows/${sharedWorkflow.id}`,
  );
  expect(revokedWorkflow.status).toBe(404);

  const retainedOwnerWorkflow = await authenticatedApi(
    page,
    `/api/store/workflows/${sharedWorkflow.id}`,
  );
  expect(retainedOwnerWorkflow.status).toBe(200);
  expect(
    (retainedOwnerWorkflow.payload as { workflow?: { title?: string } })
      .workflow?.title,
  ).toBe('Default Workflow');
});
