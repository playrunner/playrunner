import assert from 'node:assert/strict';
import { test } from 'node:test';
import { executeHuggingFace } from '../orchestrator';

// Explicitly selected by test:live; never part of the default package test run.
const accessToken = process.env.HF_TOKEN?.trim();
if (!accessToken) {
  throw new Error(
    'Set HF_TOKEN in the local environment before running live inference tests.',
  );
}

for (const action of [
  'text-generation',
  'text-classification',
  'feature-extraction',
]) {
  test(`@live Hugging Face ${action}`, { timeout: 90_000 }, async () => {
    const result = await executeHuggingFace({
      executionId: 'huggingface-live-smoke',
      node: {
        id: action,
        nodeType: 'huggingface',
        config: {
          action,
          input:
            action === 'text-generation'
              ? 'Reply with the single word hello.'
              : 'This is a wonderful product. I love it.',
          parameters:
            action === 'text-generation'
              ? { max_new_tokens: 32, return_full_text: false }
              : action === 'text-classification'
                ? { top_k: 2 }
                : { normalize: true },
        },
      },
      settings: { accessToken },
      env: {},
      workflow: {},
      renderTemplate: (value) => value,
      log: async () => undefined,
      signal: AbortSignal.timeout(85_000),
    });
    assert.equal(result.outcome, 'success');
    const output = result.output as { result: { data: unknown } };
    const data = output.result.data;
    if (action === 'text-generation') {
      assert.ok(
        typeof data === 'object' && data !== null && 'generated_text' in data,
      );
      assert.equal(typeof data.generated_text, 'string');
      assert.ok(String(data.generated_text).trim().length > 0);
    } else if (action === 'text-classification') {
      assert.ok(Array.isArray(data) && data.length > 0);
      assert.equal(data[0].label, 'POSITIVE');
      assert.ok(data[0].score > 0.5);
    } else {
      assert.ok(Array.isArray(data) && data.length > 0);
      const values: unknown[] = data.flat(Infinity);
      assert.ok(
        values.length > 0 &&
          values.every(
            (value) => typeof value === 'number' && Number.isFinite(value),
          ),
      );
    }
  });
}
