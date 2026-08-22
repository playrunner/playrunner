import assert from 'node:assert/strict';
import test from 'node:test';
import { localStartFailurePolicy } from './workflow-execution';

test('local runner start failures preserve ambiguous invocations', () => {
  assert.deepEqual(localStartFailurePolicy(false), {
    cleanupEventTransport: false,
    eventType: 'log',
    httpStatus: 202,
  });
});

test('local runner setup failures and HTTP rejections are terminal', () => {
  assert.deepEqual(localStartFailurePolicy(true), {
    cleanupEventTransport: true,
    eventType: 'workflow_failed',
    httpStatus: 500,
  });
});
