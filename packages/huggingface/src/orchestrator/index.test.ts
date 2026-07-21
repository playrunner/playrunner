import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { NodeExecutionContext } from '@playrunner/integration-sdk/orchestrator';
import huggingFaceOrchestratorContribution, {
  executeHuggingFace,
  type HuggingFaceClientFactory,
} from './index';

function context(
  overrides: Partial<NodeExecutionContext> = {},
): NodeExecutionContext {
  return {
    executionId: 'execution-1',
    node: {
      id: 'huggingface-1',
      nodeType: 'huggingface',
      config: {
        action: 'text-generation',
        provider: 'auto',
        model: 'google/gemma-2-2b-it',
        input: 'Summarize {{node_previous.result.data}}.',
        parameters: '{"max_new_tokens":128}',
      },
    },
    settings: { accessToken: 'hf_test_secret' },
    env: {},
    workflow: {},
    renderTemplate: (value) =>
      value.replace('{{node_previous.result.data}}', '{"failed":true}'),
    log: async () => undefined,
    signal: new AbortController().signal,
    ...overrides,
  };
}

interface RecordedCall {
  method: string;
  request: unknown;
}

function fakeClient(
  calls: RecordedCall[],
  response: unknown,
): HuggingFaceClientFactory {
  return (accessToken) => {
    assert.equal(accessToken, 'hf_test_secret');
    const run = async (method: string, request: unknown) => {
      calls.push({ method, request });
      return response;
    };
    return {
      textGeneration: (request) => run('textGeneration', request),
      textClassification: (request) => run('textClassification', request),
      featureExtraction: (request) => run('featureExtraction', request),
    };
  };
}

describe('Hugging Face orchestrator contribution', () => {
  test('registers as the default Hugging Face executor', () => {
    assert.equal(huggingFaceOrchestratorContribution.id, 'huggingface');
    assert.equal(
      huggingFaceOrchestratorContribution.executors[0].nodeType,
      'huggingface',
    );
    assert.equal(
      huggingFaceOrchestratorContribution.executors[0].default,
      true,
    );
  });

  test('runs text generation with rendered input and JSON parameters', async () => {
    const calls: RecordedCall[] = [];
    const result = await executeHuggingFace(
      context(),
      fakeClient(calls, { generated_text: 'The test failed.' }),
    );

    assert.deepEqual(calls, [
      {
        method: 'textGeneration',
        request: {
          model: 'google/gemma-2-2b-it',
          provider: 'auto',
          inputs: 'Summarize {"failed":true}.',
          parameters: { max_new_tokens: 128 },
        },
      },
    ]);
    assert.deepEqual(result.output, {
      result: {
        status: 'success',
        data: { generated_text: 'The test failed.' },
        task: 'text-generation',
        model: 'google/gemma-2-2b-it',
        provider: 'auto',
      },
    });
  });

  test('routes classification and feature extraction tasks', async () => {
    const classificationCalls: RecordedCall[] = [];
    await executeHuggingFace(
      context({
        node: {
          id: 'classification-1',
          nodeType: 'huggingface',
          config: {
            action: 'text-classification',
            input: 'This is excellent.',
          },
        },
      }),
      fakeClient(classificationCalls, [{ label: 'POSITIVE', score: 0.99 }]),
    );
    assert.equal(classificationCalls[0].method, 'textClassification');
    assert.deepEqual(classificationCalls[0].request, {
      model: 'distilbert/distilbert-base-uncased-finetuned-sst-2-english',
      provider: 'auto',
      inputs: 'This is excellent.',
    });

    const extractionCalls: RecordedCall[] = [];
    await executeHuggingFace(
      context({
        node: {
          id: 'extraction-1',
          nodeType: 'huggingface',
          config: {
            action: 'feature-extraction',
            provider: 'hf-inference',
            input: 'Embed this sentence.',
            parameters: '{"normalize":true}',
          },
        },
      }),
      fakeClient(extractionCalls, [[0.1, 0.2]]),
    );
    assert.equal(extractionCalls[0].method, 'featureExtraction');
    assert.deepEqual(extractionCalls[0].request, {
      model: 'thenlper/gte-large',
      provider: 'hf-inference',
      inputs: 'Embed this sentence.',
      normalize: true,
    });
  });

  test('rejects invalid parameters before calling the provider', async () => {
    const calls: RecordedCall[] = [];
    await assert.rejects(
      executeHuggingFace(
        context({
          node: {
            id: 'invalid-parameters',
            nodeType: 'huggingface',
            config: { input: 'Hello', parameters: '{invalid' },
          },
        }),
        fakeClient(calls, {}),
      ),
      /Inference parameters must be valid JSON/,
    );
    assert.equal(calls.length, 0);
  });

  test('does not expose tokens or provider errors', async () => {
    const failingClient: HuggingFaceClientFactory = () => ({
      textGeneration: async () => {
        throw new Error('Token hf_test_secret was rejected');
      },
      textClassification: async () => [],
      featureExtraction: async () => [],
    });

    await assert.rejects(
      executeHuggingFace(context(), failingClient),
      (error: Error) => {
        assert.equal(
          error.message,
          'Hugging Face action failed: Hugging Face inference request failed.',
        );
        assert.doesNotMatch(error.message, /hf_test_secret|rejected/);
        return true;
      },
    );
  });
});
