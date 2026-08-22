import { definePlayrunnerE2EContribution } from '@playrunner/integration-sdk/e2e';

export const agentContainerE2EContribution = definePlayrunnerE2EContribution({
  id: 'agent-container',
  createData: ({ runId }) => ({ runId }),
  createPom: ({ host, page }) => ({ host, page }),
  scenarios: [
    {
      id: 'configure-agent-container',
      mode: 'mock',
      title: 'configures and persists an AI Container node',
      tags: ['@agent-container', '@integration', '@node'],
      async run({ expect, host, page }) {
        await host.openNewWorkflow();
        await host.addNode('agent-container');
        await host.openNodeSettings('agent-container');
        await expect(
          page.getByTestId('agent-container-tab-config'),
        ).toBeVisible();
        await expect(page.getByTestId('agent-container-tab-env')).toBeVisible();
        await expect(
          page.getByTestId('agent-container-tab-resources'),
        ).toBeVisible();
        const maxDuration = page.getByTestId(
          'agent-container-max-duration-minutes',
        );
        await expect(maxDuration).toHaveValue('30');
        await expect(maxDuration).toHaveAttribute('min', '1');
        await expect(maxDuration).toHaveAttribute('max', '45');
        const attempts = page.getByTestId('agent-container-attempts');
        await expect(attempts).toHaveValue('3');
        await expect(attempts).toHaveAttribute('min', '1');
        await expect(attempts).toHaveAttribute('max', '10');
        await page
          .getByTestId('agent-container-task')
          .fill('Test checkout behavior');
        const repository = page.getByTestId('agent-container-repository');
        await expect(repository).toBeEnabled();
        await expect(repository).toContainText('playrunner/e2e-fixture');
        await repository.selectOption('playrunner/e2e-fixture');

        const botPrFork = page.getByTestId('agent-container-bot-pr-fork');
        await expect(botPrFork).toBeEnabled();
        await expect(botPrFork).toContainText('playrunner-bot/e2e-fixture');
        await botPrFork.selectOption('playrunner-bot/e2e-fixture');

        const branch = page.getByTestId('agent-container-branch');
        await expect(branch).toBeEnabled();
        await expect(branch).toContainText('main');
        await branch.selectOption('main');
        await host.closeNodeSettings();
        await host.saveWorkflow();
        await host.reloadWorkflow();
        await host.openNodeSettings('agent-container');
        await expect(page.getByTestId('agent-container-task')).toHaveValue(
          'Test checkout behavior',
        );
        await expect(
          page.getByTestId('agent-container-repository'),
        ).toHaveValue('playrunner/e2e-fixture');
        await expect(
          page.getByTestId('agent-container-bot-pr-fork'),
        ).toHaveValue('playrunner-bot/e2e-fixture');
        await expect(page.getByTestId('agent-container-branch')).toHaveValue(
          'main',
        );
        await expect(
          page.getByTestId('agent-container-max-duration-minutes'),
        ).toHaveValue('30');

        await page
          .getByTestId('agent-container-max-duration-minutes')
          .fill('90');
        await expect(
          page.getByTestId('agent-container-max-duration-minutes'),
        ).toHaveValue('45');
        await host.closeNodeSettings();
        await host.saveWorkflow();
        await host.reloadWorkflow();
        await host.openNodeSettings('agent-container');
        await expect(
          page.getByTestId('agent-container-max-duration-minutes'),
        ).toHaveValue('45');
        await page.getByTestId('agent-container-attempts').fill('0');
        await expect(page.getByTestId('agent-container-attempts')).toHaveValue(
          '1',
        );
        await page
          .getByTestId('agent-container-max-duration-minutes')
          .fill('0');
        await expect(
          page.getByTestId('agent-container-max-duration-minutes'),
        ).toHaveValue('1');

        await page.getByTestId('agent-container-tab-env').click();
        await expect(
          page.getByTestId('agent-container-node-env-vars'),
        ).toBeVisible();
        await expect(page.getByTestId('agent-container-task')).toHaveCount(0);

        await page.getByTestId('agent-container-tab-resources').click();
        await expect(page.getByTestId('agent-container-cpu')).toHaveValue('4');
        await expect(page.getByTestId('agent-container-memory')).toHaveValue(
          '8',
        );

        await page.getByTestId('agent-container-tab-config').click();
        await expect(page.getByTestId('agent-container-task')).toBeVisible();

        await host.closeNodeSettings();
        const containerNode = page.getByTestId('canvas-node-agent-container');
        await expect(
          containerNode.getByText('Agent', { exact: true }),
        ).toBeVisible();
        await expect(
          containerNode.getByText('Validator', { exact: true }),
        ).toBeVisible();
        await expect(containerNode).toHaveCSS('height', '128px');

        const containerBox = await containerNode.boundingBox();
        const agentSocketBox = await page
          .getByTestId('agent-container-agent-socket')
          .boundingBox();
        const validatorSocketBox = await page
          .getByTestId('agent-container-tool-socket')
          .boundingBox();
        expect(containerBox).not.toBeNull();
        expect(agentSocketBox).not.toBeNull();
        expect(validatorSocketBox).not.toBeNull();
        expect(
          Math.abs(
            agentSocketBox!.y +
              agentSocketBox!.height / 2 -
              (containerBox!.y + containerBox!.height),
          ),
        ).toBeLessThanOrEqual(2);
        expect(
          Math.abs(
            validatorSocketBox!.y +
              validatorSocketBox!.height / 2 -
              (containerBox!.y + containerBox!.height),
          ),
        ).toBeLessThanOrEqual(2);

        for (const attachmentKind of ['agent', 'tool']) {
          const socketBox = await page
            .getByTestId(`agent-container-${attachmentKind}-socket`)
            .boundingBox();
          const stemBox = await page
            .getByTestId(`agent-container-add-${attachmentKind}-stem`)
            .boundingBox();
          const addButtonBox = await page
            .getByTestId(`agent-container-add-${attachmentKind}`)
            .boundingBox();
          expect(socketBox).not.toBeNull();
          expect(stemBox).not.toBeNull();
          expect(addButtonBox).not.toBeNull();
          expect(
            Math.abs(stemBox!.y - (socketBox!.y + socketBox!.height)),
          ).toBeLessThanOrEqual(1);
          expect(
            Math.abs(stemBox!.y + stemBox!.height - addButtonBox!.y),
          ).toBeLessThanOrEqual(1);
        }

        await page.getByTestId('agent-container-add-agent').click();
        const agentDialog = page.getByRole('dialog', { name: 'Add Agent' });
        await expect(agentDialog).toBeVisible();
        await expect(
          page.getByTestId('node-selector-option-codex-cli'),
        ).toBeVisible();
        await expect(
          page.getByTestId('node-selector-option-validator'),
        ).toHaveCount(0);
        await page.getByTestId('node-selector-option-codex-cli').click();

        await expect(page.getByTestId('canvas-node-codex-cli')).toBeVisible();
        await expect(page.getByTestId('canvas-attachment-agent')).toHaveCount(
          1,
        );
        const agentNode = page.getByTestId('canvas-node-codex-cli');
        const agentNodeBox = await agentNode.boundingBox();
        const agentNodeSocketBox = await agentNode
          .getByTestId('canvas-attachment-node-socket')
          .boundingBox();
        expect(agentNodeBox).not.toBeNull();
        expect(agentNodeSocketBox).not.toBeNull();
        expect(
          Math.abs(
            agentNodeSocketBox!.y +
              agentNodeSocketBox!.height / 2 -
              agentNodeBox!.y,
          ),
        ).toBeLessThanOrEqual(2);

        await page.getByTestId('agent-container-add-tool').click();
        const validatorDialog = page.getByRole('dialog', {
          name: 'Add Validator',
        });
        await expect(validatorDialog).toBeVisible();
        await expect(
          page.getByTestId('node-selector-option-validator'),
        ).toBeVisible();
        await expect(
          page.getByTestId('node-selector-option-codex-cli'),
        ).toHaveCount(0);
        await page.getByTestId('node-selector-option-validator').click();

        await expect(page.getByTestId('canvas-node-validator')).toBeVisible();
        await expect(page.getByTestId('canvas-attachment-tool')).toHaveCount(1);
        const validatorNode = page.getByTestId('canvas-node-validator');
        const validatorNodeBox = await validatorNode.boundingBox();
        const validatorNodeSocketBox = await validatorNode
          .getByTestId('canvas-attachment-node-socket')
          .boundingBox();
        expect(validatorNodeBox).not.toBeNull();
        expect(validatorNodeSocketBox).not.toBeNull();
        expect(
          Math.abs(
            validatorNodeSocketBox!.y +
              validatorNodeSocketBox!.height / 2 -
              validatorNodeBox!.y,
          ),
        ).toBeLessThanOrEqual(2);
      },
    },
  ],
});

export default agentContainerE2EContribution;
