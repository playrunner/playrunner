import { expect, test } from '../fixtures';

test('creates a team, shares a workflow, reloads and removes the team @workspace @teams', async ({
  page,
  projects,
  teams,
  navigation,
  data,
}) => {
  await projects.goto();
  await projects.create(data.project);
  await navigation.account('Teams');
  await teams.create(data.team);
  await expect(teams.card(data.team)).toContainText('owner');
  await teams.share(data.team, data.project);
  await expect(
    teams
      .card(data.team)
      .getByRole('button', { name: new RegExp(data.project) })
      .first(),
  ).toBeVisible();
  await teams.goto();
  await teams.open(data.team);
  await expect(teams.card(data.team)).toContainText(data.project);
  await teams.delete(data.team, false);
  await expect(teams.card(data.team)).toBeVisible();
  await teams.delete(data.team);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'No teams yet' }),
  ).toBeVisible();
  await navigation.open('Projects');
  await expect(projects.project(data.project)).toBeVisible();
});
