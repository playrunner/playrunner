import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { NodeExecutionContext } from '@playrunner/integration-sdk/orchestrator';
import { githubOrchestratorContribution } from './index';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function executionContext(
  config: Record<string, unknown>,
): NodeExecutionContext {
  return {
    executionId: 'execution-1',
    workflowId: 'workflow-1',
    node: { id: 'github-1', nodeType: 'github', config },
    settings: { accessToken: 'github-token' },
    env: {},
    workflow: {},
    renderTemplate: (value) => value.replace('{{value}}', 'rendered'),
    log: async () => {},
    signal: new AbortController().signal,
  };
}

test('creates a GitHub issue and returns reusable issue output', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(
      JSON.stringify({
        number: 42,
        title: 'Rendered title',
        body: 'rendered',
        state: 'open',
        html_url: 'https://github.com/playrunner/playrunner/issues/42',
        url: 'https://api.github.com/repos/playrunner/playrunner/issues/42',
      }),
      { status: 201 },
    );
  };

  const executor = githubOrchestratorContribution.executors[0];
  const result = await executor.execute(
    executionContext({
      repository: 'playrunner/playrunner',
      title: 'Rendered title',
      body: '{{value}}',
    }),
  );

  assert.equal(
    requestUrl,
    'https://api.github.com/repos/playrunner/playrunner/issues',
  );
  assert.equal(requestInit?.method, 'POST');
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    title: 'Rendered title',
    body: 'rendered',
  });
  assert.deepEqual(result, {
    outcome: 'success',
    output: {
      number: 42,
      title: 'Rendered title',
      body: 'rendered',
      state: 'open',
      url: 'https://github.com/playrunner/playrunner/issues/42',
      apiUrl: 'https://api.github.com/repos/playrunner/playrunner/issues/42',
    },
  });
});

test('reads a GitHub issue by number', async () => {
  let requestUrl = '';
  globalThis.fetch = async (input) => {
    requestUrl = String(input);
    return new Response(
      JSON.stringify({
        number: 7,
        title: 'Existing issue',
        body: null,
        state: 'closed',
        html_url: 'https://github.com/playrunner/playrunner/issues/7',
        url: 'https://api.github.com/repos/playrunner/playrunner/issues/7',
      }),
      { status: 200 },
    );
  };

  const executor = githubOrchestratorContribution.executors[1];
  const result = await executor.execute(
    executionContext({
      repository: 'playrunner/playrunner',
      issueNumber: '7',
    }),
  );

  assert.equal(
    requestUrl,
    'https://api.github.com/repos/playrunner/playrunner/issues/7',
  );
  const output = result.output as { number?: unknown; state?: unknown };
  assert.equal(output.number, 7);
  assert.equal(output.state, 'closed');
});

test('requires a numeric issue number for reads', async () => {
  const executor = githubOrchestratorContribution.executors[1];

  await assert.rejects(
    executor.execute(
      executionContext({
        repository: 'playrunner/playrunner',
        issueNumber: 'not-a-number',
      }),
    ),
    /numeric issue number is required/i,
  );
});
