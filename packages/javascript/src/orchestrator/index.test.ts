import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type {
  NodeExecutionContext,
  OrchestratorLogLevel,
} from '@playrunner/integration-sdk/orchestrator';
import javascriptOrchestratorContribution from './index';

function context(
  code: string,
  overrides: Partial<NodeExecutionContext> = {},
): NodeExecutionContext {
  return {
    executionId: 'execution-1',
    node: {
      id: 'code-1',
      nodeType: 'code',
      config: { code },
    },
    settings: {},
    env: { NAME: 'Playrunner' },
    nodeOutputs: {
      node_previous: { result: { passed: true } },
    },
    workflow: {
      definition: { id: 'workflow-1', name: 'Example workflow' },
      run: { id: 'execution-1', status: 'running' },
    },
    renderTemplate: (value) => value,
    log: async () => undefined,
    signal: new AbortController().signal,
    ...overrides,
  };
}

const executor = javascriptOrchestratorContribution.executors[0];

describe('JavaScript orchestrator contribution', { concurrency: false }, () => {
  test('executes code with workflow inputs and returns its output', async () => {
    const logs: { level?: OrchestratorLogLevel; message: string }[] = [];
    const result = await executor.execute(
      context(
        `
        console.log('Transforming', workflow.definition.name);
        return {
          greeting: 'Hello ' + env.NAME,
          previousPassed: nodes.node_previous.result.passed,
          workflowId: input.workflow.definition.id,
        };
      `,
        {
          log: async (message, level) => {
            logs.push({ message, level });
          },
        },
      ),
    );

    assert.deepEqual(result, {
      outcome: 'success',
      output: {
        greeting: 'Hello Playrunner',
        previousPassed: true,
        workflowId: 'workflow-1',
      },
    });
    assert.deepEqual(logs, [
      {
        level: 'info',
        message: 'Running JavaScript in an isolated process...',
      },
      {
        level: 'info',
        message: 'Transforming Example workflow',
      },
      {
        level: 'info',
        message: 'JavaScript completed successfully.',
      },
    ]);
  });

  test('does not expose Node or network capabilities', async () => {
    const result = await executor.execute(
      context(`
        return {
          fetch: typeof fetch,
          process: typeof process,
          require: typeof require,
        };
      `),
    );

    assert.deepEqual(result.output, {
      fetch: 'undefined',
      process: 'undefined',
      require: 'undefined',
    });
  });

  test('reports user-code failures', async () => {
    await assert.rejects(
      executor.execute(context(`throw new Error('Deliberate failure');`)),
      /JavaScript action failed: Deliberate failure/,
    );
  });

  test('terminates code that exceeds its configured timeout', async () => {
    await assert.rejects(
      executor.execute(
        context(`while (true) {}`, {
          node: {
            id: 'code-timeout',
            nodeType: 'code',
            config: {
              code: `while (true) {}`,
              timeoutMs: 100,
            },
          },
        }),
      ),
      /JavaScript action failed: Execution exceeded the 100ms timeout/,
    );
  });

  test('terminates the sandbox when workflow execution is cancelled', async () => {
    const controller = new AbortController();
    const execution = executor.execute(
      context(`while (true) {}`, {
        node: {
          id: 'code-cancelled',
          nodeType: 'code',
          config: {
            code: `while (true) {}`,
            timeoutMs: 60_000,
          },
        },
        signal: controller.signal,
      }),
    );

    setTimeout(() => controller.abort(), 100);

    await assert.rejects(
      execution,
      /JavaScript action failed: Execution was cancelled/,
    );
  });
});
