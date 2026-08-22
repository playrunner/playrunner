import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAgentServiceAccountRequest,
  withAgentControlTokenCreator,
} from './gcp-provisioning';

test('creates the AI Container runtime identity without adding IAM roles or bindings', () => {
  const request = createAgentServiceAccountRequest();
  assert.deepEqual(request, {
    accountId: 'playrunner-agent-runner',
    serviceAccount: {
      description:
        'Dedicated runtime identity for isolated Playrunner AI Container Cloud Run jobs. Playrunner does not add IAM role bindings.',
      displayName: 'Playrunner AI Container Runner',
    },
  });
  assert.deepEqual(Object.keys(request).sort(), [
    'accountId',
    'serviceAccount',
  ]);
});

test('grants only the orchestrator runtime permission to mint control tokens while preserving policy concurrency data', () => {
  const policy = withAgentControlTokenCreator(
    {
      bindings: [
        { members: ['allUsers'], role: 'roles/iam.serviceAccountTokenCreator' },
        {
          members: ['user:operator@example.com'],
          role: 'roles/iam.serviceAccountViewer',
        },
      ],
      etag: 'etag-1',
      version: 3,
    },
    'playrunner-orchestrator-runtime@example.iam.gserviceaccount.com',
  );

  assert.deepEqual(policy, {
    bindings: [
      {
        members: ['user:operator@example.com'],
        role: 'roles/iam.serviceAccountViewer',
      },
      {
        members: [
          'serviceAccount:playrunner-orchestrator-runtime@example.iam.gserviceaccount.com',
        ],
        role: 'roles/iam.serviceAccountTokenCreator',
      },
    ],
    etag: 'etag-1',
    version: 3,
  });
});
