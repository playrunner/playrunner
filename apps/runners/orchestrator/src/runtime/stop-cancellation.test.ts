import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { cancelPreparedRunnerMatches } from '../index';

describe('prepared runner cancellation', () => {
  test('attempts every matching cancellation and returns a sanitized 502 on failure', async () => {
    const attempts: string[] = [];
    const result = await cancelPreparedRunnerMatches([
      {
        cancel: async () => {
          attempts.push('async rejection');
          throw new Error('secret async cancellation details');
        },
      },
      {
        cancel: () => {
          attempts.push('synchronous rejection');
          throw new Error('secret synchronous cancellation details');
        },
      },
      {
        cancel: async () => {
          attempts.push('success');
        },
      },
    ]);

    assert.deepEqual(attempts, [
      'async rejection',
      'synchronous rejection',
      'success',
    ]);
    assert.deepEqual(result, {
      cancelled: 1,
      failed: 2,
      failureResponse: {
        error: 'Failed to stop one or more prepared runners.',
        status: 502,
      },
    });
    assert.doesNotMatch(JSON.stringify(result), /secret|cancellation details/i);
  });

  test('reports every fulfilled cancellation without an error response', async () => {
    const result = await cancelPreparedRunnerMatches([
      { cancel: async () => {} },
      { cancel: async () => {} },
    ]);

    assert.deepEqual(result, {
      cancelled: 2,
      failed: 0,
      failureResponse: null,
    });
  });
});
