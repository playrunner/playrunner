import { expect, test } from '../fixtures';

test.describe('Project and workflow management @workspace @projects', () => {
  test('validates and cancels project creation without saving', async ({
    page,
    projects,
  }) => {
    await projects.goto();
    await expect(
      page.getByText('No projects found. Create one to get started.'),
    ).toBeVisible();
    await projects.beginCreate();
    await projects.createDialog
      .getByRole('textbox', { name: 'Project name' })
      .fill('   ');
    await expect(
      projects.createDialog.getByRole('button', {
        name: 'Create project',
        exact: true,
      }),
    ).toBeDisabled();
    await projects.createDialog.getByRole('button', { name: 'Cancel' }).click();
    await page.reload();
    await expect(page.getByTestId('project-card')).toHaveCount(0);
  });

  test('creates, renames, reloads and deletes a project and its workflow', async ({
    page,
    projects,
    navigation,
    data,
  }) => {
    await projects.goto();
    await projects.create(data.project);
    await expect(projects.workflow(data.project)).toContainText('2 Nodes');
    await projects.renameWorkflow(data.project, data.workflow);
    await projects.renameProject(`${data.project} renamed`);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: `${data.project} renamed`, level: 1 }),
    ).toBeVisible();
    await expect(projects.workflow(data.workflow)).toBeVisible();
    await projects.deleteWorkflow(data.workflow, false);
    await expect(projects.workflow(data.workflow)).toBeVisible();
    await projects.deleteWorkflow(data.workflow);
    await expect(
      page.getByText('No workflows found. Create one to get started.'),
    ).toBeVisible();
    await navigation.open('Projects');
    await projects.deleteProject(`${data.project} renamed`, false);
    await expect(projects.project(`${data.project} renamed`)).toBeVisible();
    await projects.deleteProject(`${data.project} renamed`);
    await page.reload();
    await expect(projects.project(`${data.project} renamed`)).toHaveCount(0);
  });

  test('persists starting-node order and resets project defaults', async ({
    page,
    projects,
    data,
  }) => {
    await projects.goto();
    await projects.create(data.project);
    await projects.settings();
    await projects.settingsDialog
      .getByRole('button', { name: 'Move starting node 2 up', exact: true })
      .click();
    await projects.settingsDialog
      .getByRole('button', { name: 'Add starting node', exact: true })
      .click();
    await projects.settingsDialog
      .getByRole('combobox', { name: 'Starting node 3', exact: true })
      .selectOption('code');
    await projects.saveSettings();
    await page.reload();
    await projects.settings();
    await expect(
      projects.settingsDialog.getByRole('combobox', {
        name: 'Starting node 1',
        exact: true,
      }),
    ).toHaveValue('playwright');
    await expect(
      projects.settingsDialog.getByRole('combobox', {
        name: 'Starting node 2',
        exact: true,
      }),
    ).toHaveValue('environment');
    await expect(
      projects.settingsDialog.getByRole('combobox', {
        name: 'Starting node 3',
        exact: true,
      }),
    ).toHaveValue('code');
    await projects.settingsDialog
      .getByRole('button', { name: 'Reset', exact: true })
      .click();
    await projects.saveSettings();
    await projects.settings();
    await expect(projects.settingsDialog.getByRole('combobox')).toHaveCount(2);
    await expect(
      projects.settingsDialog.getByRole('combobox', {
        name: 'Starting node 1',
        exact: true,
      }),
    ).toHaveValue('environment');
  });
});
