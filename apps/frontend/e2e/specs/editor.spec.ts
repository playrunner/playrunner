import { JavascriptE2EPom } from '@playrunner/javascript/e2e';
import { expect, test } from '../fixtures';

test('uses project defaults, persists editor changes and records a completed local run @editor @journey', async ({
  page,
  projects,
  host,
  navigation,
  data,
}) => {
  const editor = host.editor;
  const code = new JavascriptE2EPom(page, host);
  const script = `return { message: ${JSON.stringify(data.workflow)} };`;

  await test.step('Create project and choose defaults for subsequent workflows', async () => {
    await projects.goto();
    await projects.create(data.project);
    await projects.settings();
    await projects.settingsDialog
      .getByRole('combobox', { name: 'Starting node 1', exact: true })
      .selectOption('code');
    await projects.settingsDialog
      .getByRole('button', { name: 'Remove starting node 2', exact: true })
      .click();
    await projects.saveSettings();
    // Editing defaults must not change the existing workflow.
    await expect(projects.workflow(data.project)).toContainText('2 Nodes');
    await page
      .getByRole('button', { name: 'New Workflow', exact: true })
      .click();
    await editor.ready();
    expect(
      (await editor.definition()).nodes.map((node) => node.nodeType),
    ).toEqual(['code']);
  });

  await test.step('Configure, rename, save and reload through the editor', async () => {
    await editor.openNodeSettings('code');
    await code.scriptInput.fill(script);
    await editor.closeNodeSettings();
    await editor.rename(data.workflow);
    await editor.saveWorkflow();
    await editor.reloadWorkflow();
    await expect(page.getByTitle('Click to rename workflow')).toHaveText(
      data.workflow,
    );
    const definition = await editor.definition();
    expect(definition.nodes).toHaveLength(1);
    expect(definition.nodes[0].config?.code).toBe(script);
    expect(definition.cloudProvider).toBe('LOCAL_RUNNER');
  });

  await test.step('Run locally and verify terminal completion in Insights', async () => {
    expect(await editor.runWorkflowNode('code')).toBe('success');
    await navigation.open('Insights');
    await expect(
      page.getByText('1 completed, 0 failed', { exact: true }),
    ).toBeVisible();
    const health = page.locator('section').filter({
      has: page.getByRole('heading', {
        name: 'Workflow Health',
        exact: true,
      }),
    });
    await expect(
      health.getByRole('row').filter({ hasText: data.workflow }),
    ).toContainText('Completed');
    await page.reload();
    await expect(
      page.getByText('1 completed, 0 failed', { exact: true }),
    ).toBeVisible();
  });
});

test('searches the node catalogue and preserves the saved graph after canvas layout actions @editor', async ({
  page,
  host,
  projects,
  data,
}) => {
  await projects.goto();
  await projects.create(data.project);
  await projects
    .workflow(data.project)
    .getByRole('heading', { name: data.project, exact: true })
    .click();
  await host.editor.ready();
  const before = await host.editor.definition();
  expect(before.nodes).toHaveLength(2);
  expect(before.connections).toHaveLength(1);
  await page.getByTitle('Add Node', { exact: true }).click();
  const selector = page.getByRole('dialog', { name: 'Add node', exact: true });
  await selector.getByRole('textbox').fill('NoSuchIntegration');
  await expect(selector.locator('[data-node-type]')).toHaveCount(0);
  await selector.getByRole('textbox').fill('Javascript');
  await expect(selector.locator('[data-node-type]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(selector).toBeHidden();
  await page.getByTitle('Zoom In', { exact: true }).click();
  await page.getByTitle('Zoom Out', { exact: true }).click();
  await page.getByTitle('Fit View', { exact: true }).click();
  await page.getByTitle('Auto-arrange nodes', { exact: true }).click();
  await host.saveWorkflow();
  await host.reloadWorkflow();
  const after = await host.editor.definition();
  expect(after.nodes.map((node) => node.id).sort()).toEqual(
    before.nodes.map((node) => node.id).sort(),
  );
  expect(after.connections).toEqual(before.connections);
});
