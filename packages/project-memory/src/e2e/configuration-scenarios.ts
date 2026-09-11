import { definePlayrunnerE2EContribution } from '@playrunner/integration-sdk/e2e';

export const projectMemoryE2EContribution = definePlayrunnerE2EContribution({
  id: 'project-memory',
  createData: ({ runId }) => ({ namespace: `project-${runId}` }),
  createPom: ({ host, page }) => ({ host, page }),
  scenarios: [
    {
      id: 'configure-project-memory',
      mode: 'mock',
      title: 'configures and persists a Project Memory attachment',
      tags: ['@project-memory', '@integration', '@node'],
      async run({ data, expect, host, page }) {
        await host.openNewWorkflow();
        await host.addNode('project-memory');
        await host.openNodeSettings('project-memory');
        await expect(page.getByTestId('project-memory-scope')).toHaveValue(
          'project',
        );
        await page.getByTestId('project-memory-scope').selectOption('workflow');
        await page.getByTestId('project-memory-namespace').fill(data.namespace);
        await host.closeNodeSettings();
        await host.saveWorkflow();
        await host.reloadWorkflow();
        await host.openNodeSettings('project-memory');
        await expect(page.getByTestId('project-memory-scope')).toHaveValue(
          'workflow',
        );
        await expect(page.getByTestId('project-memory-namespace')).toHaveValue(
          data.namespace,
        );
      },
    },
  ],
});

export default projectMemoryE2EContribution;
