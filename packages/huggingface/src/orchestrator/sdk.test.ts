import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NodeExecutionContext } from '@playrunner/integration-sdk/orchestrator';
import { executeHuggingFace } from './index';

function context(config: Record<string, unknown> = {}): NodeExecutionContext {
  return {
    executionId: 'sdk-test',
    node: {
      id: 'hf',
      nodeType: 'huggingface',
      config: {
        input: 'Say {{env.GREETING}}',
        parameters: { max_new_tokens: 32, return_full_text: false },
        ...config,
      },
    },
    settings: { accessToken: 'hf_synthetic_test_token' },
    env: {},
    workflow: {},
    renderTemplate: (value) => value.replace('{{env.GREETING}}', 'hello'),
    log: async () => undefined,
    signal: new AbortController().signal,
  };
}

test('real SDK routes the default instruction model through chat completion', async (t) => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  t.mock.method(
    globalThis,
    'fetch',
    async (resource: string | URL, init?: RequestInit) => {
      const url = String(resource);
      assert.equal(
        new Headers(init?.headers).get('Authorization'),
        'Bearer hf_synthetic_test_token',
      );
      if (url.startsWith('https://huggingface.co/api/models/')) {
        return Response.json({
          inferenceProviderMapping: {
            'featherless-ai': {
              status: 'live',
              task: 'conversational',
              providerId: 'google/gemma-2-2b-it',
            },
          },
        });
      }
      requests.push({ url, body: JSON.parse(String(init?.body)) });
      return Response.json({
        id: 'chat-test',
        created: 1,
        usage: {},
        model: 'google/gemma-2-2b-it',
        choices: [{ message: { role: 'assistant', content: 'hello' } }],
      });
    },
  );
  const result = await executeHuggingFace(context());
  assert.equal(result.outcome, 'success');
  assert.deepEqual(result.output, {
    result: {
      status: 'success',
      data: { generated_text: 'hello' },
      task: 'text-generation',
      model: 'google/gemma-2-2b-it',
      provider: 'auto',
    },
  });
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    'https://router.huggingface.co/featherless-ai/v1/chat/completions',
  );
  assert.deepEqual(requests[0].body, {
    model: 'google/gemma-2-2b-it',
    max_tokens: 32,
    messages: [{ role: 'user', content: 'Say hello' }],
  });
});

test('real SDK preserves raw text completion for a compatible model', async (t) => {
  let posted = false;
  t.mock.method(
    globalThis,
    'fetch',
    async (resource: string | URL, init?: RequestInit) => {
      if (String(resource).startsWith('https://huggingface.co/api/models/')) {
        return Response.json({
          inferenceProviderMapping: [
            {
              provider: 'featherless-ai',
              status: 'live',
              task: 'text-generation',
              providerId: 'test/completion',
            },
          ],
        });
      }
      assert.equal(
        String(resource),
        'https://router.huggingface.co/featherless-ai/v1/completions',
      );
      const body = JSON.parse(String(init?.body));
      assert.equal(body.prompt, 'Say hello');
      assert.equal(body.max_tokens, 32);
      posted = true;
      return Response.json({
        model: 'test/completion',
        choices: [{ text: 'hello' }],
      });
    },
  );
  const result = await executeHuggingFace(
    context({ model: 'test/completion' }),
  );
  assert.equal(posted, true);
  assert.equal(result.outcome, 'success');
});

test('explicit incompatible providers fail before inference', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      inferenceProviderMapping: {
        'featherless-ai': { status: 'live', task: 'conversational' },
      },
    }),
  );
  await assert.rejects(
    executeHuggingFace(context({ provider: 'groq' })),
    /No compatible live text generation provider/,
  );
});

test('chat conversion preserves full text and explicit token limits', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async (resource: string | URL, init?: RequestInit) => {
      if (String(resource).startsWith('https://huggingface.co/api/models/')) {
        return Response.json({
          inferenceProviderMapping: {
            'featherless-ai': {
              status: 'live',
              task: 'conversational',
              providerId: 'test/chat',
            },
          },
        });
      }
      assert.equal(JSON.parse(String(init?.body)).max_tokens, 8);
      return Response.json({
        id: 'chat-test',
        created: 1,
        usage: {},
        model: 'test/chat',
        choices: [{ message: { content: ' hello' } }],
      });
    },
  );
  const result = await executeHuggingFace(
    context({
      model: 'test/chat',
      parameters: { max_tokens: 8, max_new_tokens: 32, return_full_text: true },
    }),
  );
  assert.deepEqual(
    (result.output as { result: { data: unknown } }).result.data,
    {
      generated_text: 'Say hello hello',
    },
  );
});

test('unsupported chat parameters are rejected instead of silently ignored', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      inferenceProviderMapping: {
        'featherless-ai': { status: 'live', task: 'conversational' },
      },
    }),
  );
  await assert.rejects(
    executeHuggingFace(context({ parameters: { top_k: 5 } })),
    /This model uses chat completion/,
  );
});

test('parameters cannot redirect authenticated inference', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Network must not be used');
  });
  for (const action of ['text-generation', 'feature-extraction']) {
    await assert.rejects(
      executeHuggingFace(
        context({
          action,
          parameters: { endpointUrl: 'https://invalid.example' },
        }),
      ),
      /parameters cannot override/,
    );
  }
});

test('cancellation reaches provider discovery and secrets stay out of errors', async (t) => {
  const controller = new AbortController();
  controller.abort();
  t.mock.method(
    globalThis,
    'fetch',
    async (_resource: unknown, init?: RequestInit) => {
      assert.equal(init?.signal, controller.signal);
      init?.signal?.throwIfAborted();
      throw new Error('hf_synthetic_test_token');
    },
  );
  await assert.rejects(
    executeHuggingFace({ ...context(), signal: controller.signal }),
    /request was cancelled/,
  );
});

test('missing chat output is not reported as success', async (t) => {
  t.mock.method(globalThis, 'fetch', async (resource: string | URL) => {
    if (String(resource).startsWith('https://huggingface.co/api/models/')) {
      return Response.json({
        inferenceProviderMapping: {
          'featherless-ai': {
            status: 'live',
            task: 'conversational',
            providerId: 'test/empty',
          },
        },
      });
    }
    return Response.json({
      id: 'chat-test',
      created: 1,
      usage: {},
      model: 'test/empty',
      choices: [{ message: { content: '' } }],
    });
  });
  await assert.rejects(
    executeHuggingFace(context({ model: 'test/empty' })),
    /no generated text/,
  );
});
