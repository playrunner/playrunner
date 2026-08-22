import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertNoProhibitedExactValues,
  containsProhibitedExactValue,
  credentialSafeErrorMessage,
  CREDENTIAL_LEAK_MESSAGE,
  normalizeProhibitedExactValues,
  redactProhibitedExactValuesDeep,
} from './secret-values';

test('normalizes, detects, and redacts exact credential values', () => {
  const values = normalizeProhibitedExactValues([
    'short-secret',
    'longer-secret-value',
    'short-secret',
    undefined,
  ]);
  assert.deepEqual(values, ['longer-secret-value', 'short-secret']);
  assert.equal(
    containsProhibitedExactValue(
      Buffer.from('prefix-longer-secret-value-suffix'),
      values,
    ),
    true,
  );
  assert.deepEqual(
    redactProhibitedExactValuesDeep(
      { nested: ['longer-secret-value', { value: 'safe' }] },
      values,
    ),
    { nested: ['[redacted]', { value: 'safe' }] },
  );
});

test('credential failures are generic and never echo the value', () => {
  const credential = 'github-secret-value';
  assert.throws(
    () => assertNoProhibitedExactValues(`leaked ${credential}`, [credential]),
    (error: Error) => {
      assert.equal(error.message, CREDENTIAL_LEAK_MESSAGE);
      assert.doesNotMatch(error.message, new RegExp(credential));
      return true;
    },
  );
  assert.equal(
    credentialSafeErrorMessage(new Error(`failed with ${credential}`), [
      credential,
    ]),
    CREDENTIAL_LEAK_MESSAGE,
  );
});
