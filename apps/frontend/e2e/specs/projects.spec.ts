import { expect, test } from '../fixtures';
import { authenticatedApi } from '../support/authenticatedApi';

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

for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`edits, persists and clears workflow descriptions on ${viewport.name} @projects`, async ({
    page,
    context,
    projects,
    data,
  }) => {
    const closeMobileNavigation = async () => {
      if (viewport.name === 'mobile') {
        await page.getByTitle('Collapse Sidebar', { exact: true }).click();
      }
    };
    await page.setViewportSize(viewport);
    await projects.goto();
    await closeMobileNavigation();
    await projects.create(data.project);
    const projectId = new URL(page.url()).pathname.split('/').pop();
    const listing = await authenticatedApi(
      page,
      `/api/store/workflows?projectId=${projectId}`,
    );
    expect(listing.status).toBe(200);
    const original = listing.payload.workflows[0];
    const other = await authenticatedApi(page, '/api/store/workflows', {
      method: 'POST',
      body: {
        projectId,
        title: 'Other workflow',
        description: 'Keep this description',
        nodes: [],
        connections: [],
      },
    });
    expect(other.status).toBe(201);
    expect(other.payload.workflow.description).toBe('Keep this description');
    await page.reload();
    await closeMobileNavigation();

    await projects.editWorkflow(data.project);
    const dialog = projects.editWorkflowDialog;
    const description = dialog.getByRole('textbox', {
      name: 'Description (optional)',
    });
    const save = dialog.getByRole('button', {
      name: 'Save changes',
      exact: true,
    });
    await expect(description).toHaveValue('');
    await description.fill('Discard this draft');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await projects.editWorkflow(data.project);
    await expect(description).toHaveValue('');

    const savedDescription =
      'Checks synced records against the source.\nReports missing records and field differences.';
    await description.fill(savedDescription);
    await context.setOffline(true);
    try {
      await save.click();
      await expect(dialog.getByRole('alert')).toContainText(
        'Could not save workflow details',
      );
      await expect(description).toHaveValue(savedDescription);
    } finally {
      await context.setOffline(false);
    }
    await page.screenshot({
      animations: 'disabled',
      path: `test-results/workflow-description-${viewport.name}-dialog.png`,
    });
    await save.click();
    await expect(dialog).toBeHidden();
    await expect(projects.workflow(data.project)).toContainText(
      savedDescription,
    );
    await page.reload();
    await closeMobileNavigation();
    await expect(projects.workflow(data.project)).toContainText(
      savedDescription,
    );
    await expect(projects.workflow('Other workflow')).toContainText(
      'Keep this description',
    );
    const persisted = await authenticatedApi(
      page,
      `/api/store/workflows/${original.id}`,
    );
    expect(persisted.payload.workflow).toMatchObject({
      title: original.title,
      description: savedDescription,
      nodes: original.nodes,
      connections: original.connections,
      cloudProvider: original.cloudProvider,
      concurrency: original.concurrency,
    });
    await page.screenshot({
      animations: 'disabled',
      path: `test-results/workflow-description-${viewport.name}-cards.png`,
    });

    // Existing editor saves omit description; they must preserve it.
    const renamed = await authenticatedApi(
      page,
      `/api/store/workflows/${original.id}`,
      {
        method: 'PUT',
        body: { title: data.workflow },
      },
    );
    expect(renamed.status).toBe(200);
    expect(renamed.payload.workflow.description).toBe(savedDescription);
    await page.reload();
    await closeMobileNavigation();
    await projects.editWorkflow(data.workflow);
    await expect(description).toHaveValue(savedDescription);
    await description.fill('   ');
    await save.click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await closeMobileNavigation();
    await expect(projects.workflow(data.workflow)).toContainText(
      'Design and configure your automated CI/CD and testing pipelines.',
    );
    const cleared = await authenticatedApi(
      page,
      `/api/store/workflows/${original.id}`,
    );
    expect(cleared.payload.workflow.description).toBeNull();
    await projects.editWorkflow(data.workflow);
    await expect(description).toHaveValue('');
  });
}
