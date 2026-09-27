import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { executeTeams } from '../src/orchestrator/index.ts';
import type { NodeExecutionContext } from '@playrunner/integration-sdk/orchestrator';
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function context(): NodeExecutionContext {
  return {
    executionId: 'run',
    node: {
      id: 'node',
      nodeType: 'microsoft-teams',
      config: {
        teamId: 'team/id',
        channelId: '19:channel@thread.tacv2',
        message: 'Workflow {{workflow.run.status}}',
      },
    },
    settings: { accessToken: 'secret-token' },
    env: {},
    workflow: {},
    renderTemplate: (value) =>
      value.replace('{{workflow.run.status}}', 'completed'),
    log: async () => {},
    signal: new AbortController().signal,
  };
}
test('sends a rendered plain text message with encoded IDs and returns the message ID', async () => {
  const ctx = context();
  globalThis.fetch = async (url, options) => {
    assert.equal(
      String(url),
      'https://graph.microsoft.com/v1.0/teams/team%2Fid/channels/19%3Achannel%40thread.tacv2/messages',
    );
    assert.equal(
      (options!.headers as Record<string, string>).Authorization,
      'Bearer secret-token',
    );
    assert.deepEqual(JSON.parse(options!.body as string), {
      body: { contentType: 'text', content: 'Workflow completed' },
    });
    assert.ok(options!.signal);
    assert.equal(options!.redirect, 'error');
    return Response.json(
      { id: 'message-1', body: { content: 'private-content' } },
      { status: 201 },
    );
  };
  assert.deepEqual(await executeTeams(ctx), {
    outcome: 'success',
    output: { messageId: 'message-1' },
  });
});
test('requires connection, destination, and nonempty rendered message', async () => {
  globalThis.fetch = async () => {
    throw new Error('Should not send');
  };
  for (const key of ['teamId', 'channelId', 'message']) {
    const ctx = context();
    ctx.node.config[key] = '';
    await assert.rejects(executeTeams(ctx), /required/);
  }
  await assert.rejects(
    executeTeams({ ...context(), settings: {} }),
    /connection is required/,
  );
  await assert.rejects(
    executeTeams({ ...context(), renderTemplate: () => '' }),
    /required/,
  );
});
test('reports safe HTTP errors without provider bodies or tokens', async () => {
  for (const status of [401, 403, 404, 429, 500]) {
    globalThis.fetch = async () =>
      new Response('secret-token private-content', { status });
    await assert.rejects(executeTeams(context()), (error: Error) => {
      assert.match(error.message, new RegExp(`HTTP ${status}`));
      assert.doesNotMatch(error.message, /secret-token|private-content/);
      return true;
    });
  }
});
test('sanitizes network failures and malformed successful responses', async () => {
  globalThis.fetch = async () => {
    throw new Error('secret-token');
  };
  await assert.rejects(
    executeTeams(context()),
    /^Error: Microsoft Teams request failed\.$/,
  );
  globalThis.fetch = async () => Response.json({});
  await assert.rejects(executeTeams(context()), /invalid message response/);
});
test('does not send a cancelled request', async () => {
  let sent = false;
  globalThis.fetch = async () => {
    sent = true;
    return Response.json({ id: 'message' });
  };
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    executeTeams({ ...context(), signal: controller.signal }),
    /cancelled/,
  );
  assert.equal(sent, false);
});
