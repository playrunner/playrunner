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
  settings: Record<string, unknown> = { accessToken: 'github-token' },
): NodeExecutionContext {
  return {
    executionId: 'execution-1',
    workflowId: 'workflow-1',
    node: { id: 'github-1', nodeType: 'github', config },
    settings,
    env: {},
    workflow: {},
    renderTemplate: (value) => value.replace('{{value}}', 'rendered'),
    log: async () => {},
    signal: new AbortController().signal,
  };
}

test('uses an injected GitHub API base URL for deterministic E2E', async () => {
  let requestUrl = '';
  globalThis.fetch = async (input) => {
    requestUrl = String(input);
    return Response.json({ number: 1, state: 'open', title: 'E2E issue' });
  };

  await executor('create').execute(
    executionContext(
      { repository: 'playrunner/e2e-fixture', title: 'E2E issue' },
      {
        accessToken: 'github-token',
        apiBaseUrl: 'http://host.docker.internal:4010/',
      },
    ),
  );

  assert.equal(
    requestUrl,
    'http://host.docker.internal:4010/repos/playrunner/e2e-fixture/issues',
  );
});

function executor(action: string) {
  const match = githubOrchestratorContribution.executors.find(
    (candidate) => candidate.action === action,
  );
  assert.ok(match, `Expected a GitHub executor for ${action}.`);
  return match;
}

test('creates a GitHub issue and returns reusable issue output', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(
      JSON.stringify({
        id: 123456789,
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

  const result = await executor('create').execute(
    executionContext({
      repository: 'playrunner/playrunner',
      title: 'Rendered title',
      body: '{{value}}',
      labels: 'bug, {{value}}',
      assignees: 'octocat',
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
    labels: ['bug', 'rendered'],
    assignees: ['octocat'],
  });
  assert.deepEqual(result, {
    outcome: 'success',
    output: {
      result: {
        status: 'success',
        data: {
          id: 123456789,
          number: 42,
          title: 'Rendered title',
          body: 'rendered',
          state: 'open',
          url: 'https://github.com/playrunner/playrunner/issues/42',
          apiUrl:
            'https://api.github.com/repos/playrunner/playrunner/issues/42',
        },
      },
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

  const result = await executor('read').execute(
    executionContext({
      repository: 'playrunner/playrunner',
      issueNumber: '7',
    }),
  );

  assert.equal(
    requestUrl,
    'https://api.github.com/repos/playrunner/playrunner/issues/7',
  );
  const output = result.output as {
    acceptanceCriteria?: Record<string, unknown>;
    result?: { data?: { number?: unknown; state?: unknown } };
  };
  assert.equal(output.result?.data?.number, 7);
  assert.equal(output.result?.data?.state, 'closed');
  assert.deepEqual(output.acceptanceCriteria, {
    body: '',
    id: 'playrunner/playrunner#7',
    source: 'github',
    title: 'Existing issue',
    url: 'https://github.com/playrunner/playrunner/issues/7',
  });
});

test('requires a numeric issue number for reads', async () => {
  await assert.rejects(
    executor('read').execute(
      executionContext({
        repository: 'playrunner/playrunner',
        issueNumber: 'not-a-number',
      }),
    ),
    /numeric issue number is required/i,
  );
});

test('updates a GitHub issue title and closes it as not planned', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return Response.json({
      number: 18,
      title: 'rendered',
      body: 'Existing body',
      state: 'closed',
      html_url: 'https://github.com/playrunner/playrunner/issues/18',
      url: 'https://api.github.com/repos/playrunner/playrunner/issues/18',
    });
  };

  const result = await executor('update').execute(
    executionContext({
      repository: 'playrunner/playrunner',
      issueNumber: '18',
      title: '{{value}}',
      state: 'not_planned',
    }),
  );

  assert.equal(
    requestUrl,
    'https://api.github.com/repos/playrunner/playrunner/issues/18',
  );
  assert.equal(requestInit?.method, 'PATCH');
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    title: 'rendered',
    state: 'closed',
    state_reason: 'not_planned',
  });
  assert.equal(
    (
      result.output as {
        result?: { data?: { state?: unknown } };
      }
    ).result?.data?.state,
    'closed',
  );
});

test('adds a comment to an issue or pull request timeline', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(
      JSON.stringify({
        id: 99,
        body: 'Status: rendered',
        html_url:
          'https://github.com/playrunner/playrunner/issues/4#issuecomment-99',
        url: 'https://api.github.com/repos/playrunner/playrunner/issues/comments/99',
        issue_url:
          'https://api.github.com/repos/playrunner/playrunner/issues/4',
      }),
      { status: 201 },
    );
  };

  const result = await executor('comment').execute(
    executionContext({
      repository: 'playrunner/playrunner',
      issueNumber: '4',
      body: 'Status: {{value}}',
    }),
  );

  assert.equal(
    requestUrl,
    'https://api.github.com/repos/playrunner/playrunner/issues/4/comments',
  );
  assert.equal(requestInit?.method, 'POST');
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    body: 'Status: rendered',
  });
  assert.deepEqual(result.output, {
    result: {
      status: 'success',
      data: {
        id: 99,
        body: 'Status: rendered',
        url: 'https://github.com/playrunner/playrunner/issues/4#issuecomment-99',
        apiUrl:
          'https://api.github.com/repos/playrunner/playrunner/issues/comments/99',
        issueApiUrl:
          'https://api.github.com/repos/playrunner/playrunner/issues/4',
      },
    },
  });
});

test('creates a pull request from selected branches', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(
      JSON.stringify({
        number: 27,
        title: 'Ship rendered',
        body: 'Ready',
        state: 'open',
        html_url: 'https://github.com/playrunner/playrunner/pull/27',
        url: 'https://api.github.com/repos/playrunner/playrunner/pulls/27',
      }),
      { status: 201 },
    );
  };

  const result = await executor('createPullRequest').execute(
    executionContext({
      repository: 'playrunner/playrunner',
      title: 'Ship {{value}}',
      body: 'Ready',
      head: 'feature/rendered',
      base: 'main',
      draft: true,
    }),
  );

  assert.equal(
    requestUrl,
    'https://api.github.com/repos/playrunner/playrunner/pulls',
  );
  assert.equal(requestInit?.method, 'POST');
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    title: 'Ship rendered',
    head: 'feature/rendered',
    base: 'main',
    body: 'Ready',
    draft: true,
  });
  assert.equal(
    (
      result.output as {
        result?: { data?: { number?: unknown } };
      }
    ).result?.data?.number,
    27,
  );
});

test('uses the current GitHub REST API version header', async () => {
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    requestInit = init;
    return Response.json({
      number: 7,
      title: 'Existing issue',
      state: 'open',
    });
  };

  await executor('read').execute(
    executionContext({
      repository: 'playrunner/playrunner',
      issueNumber: '7',
    }),
  );

  assert.equal(
    (requestInit?.headers as Record<string, string>)['X-GitHub-Api-Version'],
    '2026-03-10',
  );
});
