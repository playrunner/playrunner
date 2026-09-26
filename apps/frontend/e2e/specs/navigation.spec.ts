import { expect, test } from '../fixtures';
import { InsightsPom } from '../core/InsightsPom';

test('navigates every workspace section and preserves the browser history @workspace @navigation', async ({
  page,
  projects,
  navigation,
}) => {
  await projects.goto();
  for (const [name, path, heading] of [
    ['Environments', '/environments', 'Environments'],
    [
      'Authentication Profiles',
      '/authentication-profiles',
      'Authentication Profiles',
    ],
    ['Integrations', '/integrations', 'Connected Integrations'],
    ['Insights', '/insights', 'Insights'],
  ] as const) {
    await navigation.open(name);
    await expect(page).toHaveURL(path);
    await expect(
      page.getByRole('heading', { name: heading, exact: true }),
    ).toBeVisible();
  }
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: 'Connected Integrations' }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole('heading', { name: 'Insights', exact: true }),
  ).toBeVisible();
  await navigation.account('Settings');
  await expect(
    page.getByRole('heading', { name: 'Profile', exact: true }),
  ).toBeVisible();
  await navigation.account('Teams');
  await expect(
    page.getByRole('heading', { name: 'Teams', exact: true }),
  ).toBeVisible();
  await navigation.open('Projects');
  await expect(page).toHaveURL('/projects');
});

test('filters and refreshes insights using persisted workspace data @workspace @insights', async ({
  page,
  projects,
  environments,
  navigation,
  data,
}) => {
  await projects.goto();
  await projects.create(data.project);
  await navigation.open('Environments');
  await environments.create(data.environment);
  await navigation.open('Insights');
  const insights = new InsightsPom(page);
  await expect(
    page.getByRole('row').filter({ hasText: data.project }),
  ).toContainText('No runs');
  await expect(page.getByText(data.environment, { exact: true })).toBeVisible();
  for (const range of ['7 days', '90 days', 'All time', '30 days'] as const)
    await insights.selectRange(range);
  await insights.refresh();
  await expect(
    page.getByRole('row').filter({ hasText: data.project }),
  ).toBeVisible();
});
