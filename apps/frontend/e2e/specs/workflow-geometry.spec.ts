import { randomUUID } from 'node:crypto';
import { expect, test } from '../fixtures';
import { authenticatedApi } from '../support/authenticatedApi';
import { WorkflowGeometryPom } from '../core/WorkflowGeometryPom';

function importedWorkflow() {
  return {
    title: `Geometry ${randomUUID()}`,
    cloudProvider: 'LOCAL_RUNNER',
    nodes: [
      {
        id: 'api-environment',
        nodeType: 'environment',
        label: 'Imported environment',
        x: '100',
        y: '100',
        width: 96,
        height: 96,
      },
      {
        id: 'api-playwright',
        nodeType: 'playwright',
        label: 'Imported Playwright',
        x: '450',
        y: '100',
        width: 96,
        height: 96,
        config: { workers: 1 },
      },
      {
        id: 'api-agent',
        nodeType: 'agent-container',
        label: 'Imported agent',
        x: 100,
        y: 400,
      },
    ],
    connections: [
      {
        id: 'api-connection',
        sourceId: 'api-environment',
        targetId: 'api-playwright',
      },
    ],
  };
}

test('API-created nodes match editor-created nodes and retain connected geometry after saving @editor @geometry', async ({
  page,
}) => {
  const editor = new WorkflowGeometryPom(page);
  await page.goto('/projects');
  const input = importedWorkflow();
  const created = await authenticatedApi(page, '/api/store/workflows', {
    method: 'POST',
    body: input,
  });
  expect(created.status).toBe(201);
  expect(created.payload.workflow.nodes[1]).toMatchObject({
    x: 450,
    y: 100,
    width: 128,
    height: 128,
  });
  expect(created.payload.workflow.connections).toEqual(input.connections);
  const id = created.payload.workflow.id;
  const updated = await authenticatedApi(page, `/api/store/workflows/${id}`, {
    method: 'PUT',
    body: input,
  });
  expect(updated.status).toBe(200);
  const saved = await authenticatedApi(page, `/api/store/workflows/${id}`);
  expect(saved.payload.workflow.nodes[1]).toMatchObject({
    width: 128,
    height: 128,
  });

  await page.goto(`/workflow/${id}`);
  await editor.ready();
  await editor.expectStandardGeometry();
  await editor.expectAddedPlaywrightMatchesImported();
  await editor.saveWorkflow();
  await editor.reloadWorkflow();
  await editor.expectStandardGeometry();
  const definition = await editor.definition();
  expect(definition.connections).toEqual(input.connections);
  expect(
    definition.nodes.find((node) => node.id === 'api-playwright')?.config,
  ).toEqual({ workers: 1 });
  await page.screenshot({ path: 'test-results/workflow-geometry.png' });
});

test('legacy saved nodes are repaired on load without recreating the workflow @editor @geometry', async ({
  page,
}) => {
  const legacy = importedWorkflow();
  // Reproduce the supplied workflow: two environments feeding Playwright,
  // with positions and connections but no dimensions on the API nodes.
  legacy.nodes = legacy.nodes.map((node) => ({
    ...node,
    width: undefined,
    height: undefined,
  }));
  legacy.nodes.push({
    id: 'api-release',
    nodeType: 'environment',
    label: 'Deployed revision',
    x: 100,
    y: 300,
  });
  legacy.connections.push({
    id: 'release-to-playwright',
    sourceId: 'api-release',
    targetId: 'api-playwright',
  });
  await page.addInitScript((workflow) => {
    window.localStorage.setItem(
      'playrunner_local_workflow',
      JSON.stringify(workflow),
    );
  }, legacy);
  // Exercise the existing local-save fallback using unnormalized legacy data.
  await page.goto(`/workflow/${randomUUID()}`);
  const editor = new WorkflowGeometryPom(page);
  await editor.ready();
  await editor.expectStandardGeometry(true);
  await editor.expectAddedPlaywrightMatchesImported();
  await editor.saveWorkflow();
  await editor.reloadWorkflow();
  await editor.expectStandardGeometry(true);
});
