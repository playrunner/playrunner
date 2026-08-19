import { expect, test } from '../fixtures';

test('adds, verifies, and removes every implemented canvas node @nodes', async ({
  page,
}) => {
  await page.goto('/projects');
  await page.getByRole('button', { name: 'New Project' }).first().click();
  await page.getByRole('heading', { name: 'Project Dashboard' }).waitFor();
  await page.getByText('Default Workflow', { exact: true }).click();

  await expect(
    page.getByRole('progressbar', { name: 'Loading page' }),
  ).toBeHidden();

  const addNodeButton = page.getByTitle('Add Node');
  await addNodeButton.waitFor();
  await addNodeButton.click();

  const selector = page.getByRole('dialog', { name: 'Add node' });
  await expect(selector).toBeVisible();
  const options = selector.locator('[data-node-type]:not([disabled])');
  const nodeTypes = await options.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-node-type')),
  );
  expect(nodeTypes.length).toBeGreaterThan(0);
  expect(nodeTypes.every((nodeType) => Boolean(nodeType))).toBe(true);
  expect(new Set(nodeTypes).size).toBe(nodeTypes.length);
  await page.keyboard.press('Escape');
  let verifiedCancellation = false;

  for (const nodeType of nodeTypes) {
    if (!nodeType) continue;

    const canvasNodes = page.getByTestId(`canvas-node-${nodeType}`);
    const countBefore = await canvasNodes.count();

    await addNodeButton.click();
    await page.getByTestId(`node-selector-option-${nodeType}`).click();
    await expect(canvasNodes).toHaveCount(countBefore + 1);
    const addedNode = canvasNodes.last();
    await expect(addedNode.getByTitle('Play')).toBeHidden();
    await expect(addedNode.getByTitle('Power')).toBeHidden();

    await page.keyboard.press('Delete');
    const deleteDialog = page.getByRole('alertdialog');
    await expect(deleteDialog).toBeVisible();
    await expect(canvasNodes).toHaveCount(countBefore + 1);

    if (!verifiedCancellation) {
      await deleteDialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(deleteDialog).toBeHidden();
      await expect(canvasNodes).toHaveCount(countBefore + 1);
      await addedNode.getByTitle('Delete Node').click();
      await expect(deleteDialog).toBeVisible();
      verifiedCancellation = true;
    }

    await deleteDialog.getByRole('button', { name: 'Delete node' }).click();
    await expect(canvasNodes).toHaveCount(countBefore);
  }
});
