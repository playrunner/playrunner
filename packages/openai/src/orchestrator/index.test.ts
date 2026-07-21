import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import type { NodeExecutionContext } from '@playrunner/integration-sdk/orchestrator';
import openaiOrchestratorContribution from './index';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function context(
  overrides: Partial<NodeExecutionContext> = {},
): NodeExecutionContext {
  return {
    executionId: 'execution-1',
    node: {
      id: 'openai-1',
      nodeType: 'openai',
      config: { prompt: 'Summarize {{node_previous.result.data}}.' },
    },
    settings: { apiKey: 'sk-test-secret' },
    env: {},
    workflow: {},
    renderTemplate: (value) =>
      value.replace('{{node_previous.result.data}}', '{"failed":true}'),
    log: async () => undefined,
    signal: new AbortController().signal,
    ...overrides,
  };
}

const executor = openaiOrchestratorContribution.executors[0];

describe('OpenAI orchestrator contribution', () => {
  test('calls the Responses API with rendered upstream input', async () => {
    let request: { input: string; init?: RequestInit } | undefined;
    globalThis.fetch = async (input, init) => {
      request = { input: String(input), init };
      return new Response(
        JSON.stringify({
          id: 'resp_123',
          model: 'gpt-5.6-sol',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'The test failed.' }],
            },
          ],
          usage: { input_tokens: 12, output_tokens: 4 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const result = await executor.execute(context());
    const body = JSON.parse(String(request?.init?.body));

    assert.equal(request?.input, 'https://api.openai.com/v1/responses');
    assert.equal(
      (request?.init?.headers as Record<string, string>).Authorization,
      'Bearer sk-test-secret',
    );
    assert.equal(body.input, 'Summarize {"failed":true}.');
    assert.equal(body.model, 'gpt-5.6');
    assert.deepEqual(body.reasoning, { effort: 'medium' });
    assert.deepEqual(result.output, {
      result: {
        status: 'success',
        data: { text: 'The test failed.' },
        model: 'gpt-5.6-sol',
        responseId: 'resp_123',
        usage: { input_tokens: 12, output_tokens: 4 },
      },
    });
  });

  test('requests and parses strict structured output', async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          output_text: '{"summary":"Failed assertion","severity":2}',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const result = await executor.execute(
      context({
        node: {
          id: 'openai-structured',
          nodeType: 'openai',
          config: {
            prompt: 'Classify this failure',
            responseFormat: 'json_schema',
            jsonSchema: JSON.stringify({
              type: 'object',
              properties: {
                summary: { type: 'string' },
                severity: { type: 'number' },
              },
              required: ['summary', 'severity'],
              additionalProperties: false,
            }),
          },
        },
      }),
    );

    assert.deepEqual((requestBody?.text as Record<string, unknown>).format, {
      type: 'json_schema',
      name: 'playrunner_output',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          severity: { type: 'number' },
        },
        required: ['summary', 'severity'],
        additionalProperties: false,
      },
    });
    assert.deepEqual(result.output, {
      result: {
        status: 'success',
        data: { summary: 'Failed assertion', severity: 2 },
        model: 'gpt-5.6',
      },
    });
  });

  test('sanitizes provider failures and credentials', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'invalid_api_key',
            message: 'The key sk-test-secret is invalid',
          },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );

    await assert.rejects(executor.execute(context()), (error: Error) => {
      assert.equal(
        error.message,
        'OpenAI action failed: OpenAI API returned 401: request failed (invalid_api_key).',
      );
      assert.doesNotMatch(error.message, /sk-test-secret|The key/);
      return true;
    });
  });

  test('rejects invalid structured-output schemas before the API call', async () => {
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return new Response('{}');
    };

    await assert.rejects(
      executor.execute(
        context({
          node: {
            id: 'openai-invalid-schema',
            nodeType: 'openai',
            config: {
              prompt: 'Return JSON',
              responseFormat: 'json_schema',
              jsonSchema: '{invalid',
            },
          },
        }),
      ),
      /Structured output schema must be valid JSON/,
    );
    assert.equal(called, false);
  });
});
