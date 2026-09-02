import assert from 'node:assert/strict';
import test from 'node:test';
import {
  machineExecutionJsonError,
  machineExecutionReplayResponse,
  parseMachinePageSize,
} from './machine-executions';

test('machine execution body parser errors are bounded JSON responses', () => {
  assert.deepEqual(machineExecutionJsonError({ type: 'entity.parse.failed' }), {
    error: 'Invalid workflow run JSON.',
    status: 400,
  });
  assert.deepEqual(machineExecutionJsonError({ type: 'entity.too.large' }), {
    error: 'Workflow run request exceeds 131072 bytes.',
    status: 413,
  });
  assert.equal(machineExecutionJsonError(new Error('database failure')), null);
});

test('an ambiguously accepted start reuses its authoritative running execution', () => {
  assert.deepEqual(
    machineExecutionReplayResponse({
      executionId: 'execution-existing',
      executionStatus: 'running',
      failureHttpStatus: 502,
      failureMessage: 'Invocation response was lost.',
      headSha: 'b'.repeat(40),
      workflowId: 'workflow-1',
    }),
    {
      body: {
        executionId: 'execution-existing',
        headSha: 'b'.repeat(40),
        idempotentReused: true,
        status: 'running',
        workflowId: 'workflow-1',
      },
      httpStatus: 202,
    },
  );
});

test('a start failure without an execution remains a bounded failure response', () => {
  assert.deepEqual(
    machineExecutionReplayResponse({
      executionId: 'execution-rejected',
      executionStatus: 'failed_to_start',
      failureHttpStatus: 503,
      failureMessage: 'Runner unavailable.',
      headSha: 'c'.repeat(40),
      workflowId: 'workflow-1',
    }),
    {
      body: {
        error: 'Runner unavailable.',
        executionId: 'execution-rejected',
        headSha: 'c'.repeat(40),
        idempotentReused: true,
        status: 'failed_to_start',
        workflowId: 'workflow-1',
      },
      httpStatus: 503,
    },
  );
});

test('machine list endpoints default their page size and reject bad limits', () => {
  assert.deepEqual(parseMachinePageSize(undefined), { take: 25 });
  assert.deepEqual(parseMachinePageSize('10'), { take: 10 });
  assert.ok('error' in parseMachinePageSize('0'));
  assert.ok('error' in parseMachinePageSize('101'));
  assert.ok('error' in parseMachinePageSize('all'));
  assert.ok('error' in parseMachinePageSize('1.5'));
});
