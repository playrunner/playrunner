import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseWorkflowRunInputs,
  WorkflowRunInputValidationError,
} from './workflow-run-inputs';

test('accepts bounded workflow inputs and acceptance criteria', () => {
  assert.deepEqual(
    parseWorkflowRunInputs({
      acceptanceCriteria: ['Ticket #46'],
      inputs: { ticket: '46' },
    }),
    { acceptanceCriteria: ['Ticket #46'], inputs: { ticket: '46' } },
  );
});

test('rejects unsafe input names', () => {
  assert.throws(
    () => parseWorkflowRunInputs({ inputs: { '../ticket': '46' } }),
    WorkflowRunInputValidationError,
  );
});
