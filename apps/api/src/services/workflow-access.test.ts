import assert from 'node:assert/strict';
import test from 'node:test';
import { serializeWorkflowAccess } from './workflow-access';

const sharedWorkflow = {
  userId: 'owner-1',
  teamShares: [
    {
      permission: 'view_run',
      team: { id: 'team-1', name: 'Quality' },
    },
  ],
};

test('serializes owner workflow access without changing ownership', () => {
  assert.deepEqual(serializeWorkflowAccess(sharedWorkflow, 'owner-1'), {
    canEdit: true,
    canRun: true,
    ownerUserId: 'owner-1',
    permission: 'owner',
    sharedTeams: [{ id: 'team-1', name: 'Quality', permission: 'view_run' }],
  });
});

test('serializes team workflow access as view and run only', () => {
  assert.deepEqual(serializeWorkflowAccess(sharedWorkflow, 'member-1'), {
    canEdit: false,
    canRun: true,
    ownerUserId: 'owner-1',
    permission: 'view_run',
    sharedTeams: [{ id: 'team-1', name: 'Quality', permission: 'view_run' }],
  });
});
