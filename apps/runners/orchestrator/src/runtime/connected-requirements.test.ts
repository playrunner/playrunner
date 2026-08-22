import assert from 'node:assert/strict';
import test from 'node:test';
import {
  requirementsFromConnectedOutputs,
  requirementsFromWorkflowInput,
} from './connected-requirements';

test('reads acceptance criteria only from connected node outputs', () => {
  assert.deepEqual(
    requirementsFromConnectedOutputs({
      node_issue: {
        acceptanceCriteria: {
          body: 'It works',
          id: 'owner/repo#46',
          source: 'github',
          title: 'Ticket 46',
          url: 'https://github.com/owner/repo/issues/46',
        },
      },
      node_unrelated: { result: { status: 'success' } },
    }),
    [
      {
        body: 'It works',
        id: 'owner/repo#46',
        source: 'github',
        title: 'Ticket 46',
        url: 'https://github.com/owner/repo/issues/46',
      },
    ],
  );
});

test('converts CLI acceptance criteria to workflow requirements', () => {
  assert.deepEqual(requirementsFromWorkflowInput('Ticket #46'), [
    {
      body: 'Ticket #46',
      id: 'CLI-1',
      source: 'workflow',
      title: 'Ticket #46',
    },
  ]);
});
