import assert from 'node:assert/strict';
import test from 'node:test';
import type { NodeExecutionContext } from '@playrunner/integration-sdk/orchestrator';
import contribution from './index';

function context(
  config: Record<string, unknown>,
  settings: Record<string, unknown> = {},
): NodeExecutionContext {
  return {
    env: {},
    executionId: 'execution-1',
    log: async () => {},
    node: { config, id: 'node-1', nodeType: 'webhooks' },
    renderTemplate: (value) => value.replace('{{value}}', 'rendered'),
    settings,
    signal: new AbortController().signal,
    workflow: {},
    workflowId: 'workflow-1',
  };
}

test('rejects private and non-HTTPS outbound targets', async () => {
  const executor = contribution.executors[0];
  await assert.rejects(
    executor.execute(context({ url: 'http://127.0.0.1/hook' })),
    /public HTTPS URL/,
  );
});

test('renders and sends an outbound JSON request', async () => {
  const originalFetch = globalThis.fetch;
  let request: Request | undefined;
  globalThis.fetch = async (input, init) => {
    request = new Request(input, init);
    return new Response('accepted', { status: 200 });
  };

  try {
    const result = await contribution.executors[0].execute(
      context(
        {
          body: '{"value":"{{value}}"}',
          headers: '{"X-Source":"playrunner"}',
          method: 'POST',
          url: 'https://hooks.example.test/receive',
        },
        { bearerToken: 'secret-token' },
      ),
    );

    assert.equal(result.outcome, 'success');
    assert.equal(request?.headers.get('authorization'), 'Bearer secret-token');
    assert.equal(request?.headers.get('x-source'), 'playrunner');
    assert.equal(await request?.text(), '{"value":"rendered"}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not execute HTTP for inbound nodes', async () => {
  const result = await contribution.executors[0].execute(
    context({ mode: 'inbound' }),
  );
  assert.deepEqual(result, { outcome: 'success' });
});
