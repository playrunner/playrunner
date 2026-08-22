import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertDetachedOrchestratorServiceConfiguration,
  getOrchestratorCloudRunConfig,
  normalizeGcpEditorApiOrigin,
  orchestratorServiceUsesRuntimeIdentity,
  withOrchestratorEditorApiEnvironment,
  withOrchestratorSecurityEnvironment,
  withPrivateOrchestratorInvokerPolicy,
} from './cloudrun';

const detachedOrchestratorSettings = {
  editorApiUrl: 'https://api.playrunner.test',
  orchestratorCallerServiceAccountEmail:
    'playrunner-api@example.iam.gserviceaccount.com',
  orchestratorCallerServiceAccountSubject: '123456789012345678901',
  orchestratorCpuIdle: false,
  orchestratorMaxInstanceCount: 10,
  orchestratorMinInstanceCount: 1,
  orchestratorRuntimeServiceAccountEmail:
    'playrunner-orchestrator-runtime@example.iam.gserviceaccount.com',
  orchestratorServiceName: 'playrunner-orchestrator',
};

test('normalizes only a server-configured credential-free HTTPS callback origin', () => {
  assert.equal(
    normalizeGcpEditorApiOrigin(' https://api.playrunner.test/internal/path '),
    'https://api.playrunner.test',
  );
  assert.throws(
    () => normalizeGcpEditorApiOrigin(undefined),
    /PLAYRUNNER_PUBLIC_API_URL must be configured/,
  );
  assert.throws(
    () => normalizeGcpEditorApiOrigin('http://api.playrunner.test'),
    /credential-free HTTPS/,
  );
  assert.throws(
    () => normalizeGcpEditorApiOrigin('https://user:secret@api.test'),
    /credential-free HTTPS/,
  );
});

test('requires the dedicated roleless orchestrator runtime identity', () => {
  const email =
    'playrunner-orchestrator-runtime@example.iam.gserviceaccount.com';
  assert.equal(
    orchestratorServiceUsesRuntimeIdentity(
      { template: { serviceAccount: email } },
      email,
    ),
    true,
  );
  assert.equal(
    orchestratorServiceUsesRuntimeIdentity(
      {
        template: {
          serviceAccount: '123-compute@developer.gserviceaccount.com',
        },
      },
      email,
    ),
    false,
  );
});

test('requires lifecycle settings that can continue detached workflow work', () => {
  assert.equal(
    getOrchestratorCloudRunConfig(detachedOrchestratorSettings)
      .minInstanceCount,
    1,
  );
  assert.equal(
    getOrchestratorCloudRunConfig(detachedOrchestratorSettings).cpuIdle,
    false,
  );

  assert.throws(
    () =>
      getOrchestratorCloudRunConfig({
        ...detachedOrchestratorSettings,
        orchestratorMinInstanceCount: 0,
      }),
    /minimum instance count must be configured as a positive integer/,
  );
  assert.throws(
    () =>
      getOrchestratorCloudRunConfig({
        ...detachedOrchestratorSettings,
        orchestratorCpuIdle: true,
      }),
    /must be false so detached workflows have always-allocated CPU/,
  );
});

test('fails closed when the applied Cloud Run lifecycle is unsafe', () => {
  const safeService = {
    scaling: { minInstanceCount: 1 },
    template: { containers: [{ resources: { cpuIdle: false } }] },
  };
  assert.doesNotThrow(() =>
    assertDetachedOrchestratorServiceConfiguration(safeService),
  );
  assert.throws(
    () =>
      assertDetachedOrchestratorServiceConfiguration({
        ...safeService,
        scaling: { minInstanceCount: 0 },
      }),
    /at least one minimum instance/,
  );
  assert.throws(
    () =>
      assertDetachedOrchestratorServiceConfiguration({
        ...safeService,
        template: { containers: [{ resources: { cpuIdle: true } }] },
      }),
    /always-allocated CPU/,
  );
  assert.throws(
    () =>
      assertDetachedOrchestratorServiceConfiguration({
        ...safeService,
        template: { containers: [{ resources: {} }] },
      }),
    /always-allocated CPU/,
  );
});

test('sets exact hosted auth environment while preserving unrelated values', () => {
  assert.deepEqual(
    withOrchestratorSecurityEnvironment(
      [
        { name: 'KEEP_ME', value: 'preserved' },
        { name: 'PLAYRUNNER_ORCHESTRATOR_AUTH_MODE', value: 'stale' },
        {
          name: 'PLAYRUNNER_ORCHESTRATOR_CALLER_SERVICE_ACCOUNT_EMAIL',
          value: 'stale@example.iam.gserviceaccount.com',
        },
      ],
      {
        audience: 'https://orchestrator.example.run.app',
        caller: {
          email: 'playrunner-api@example.iam.gserviceaccount.com',
          subject: '123456789012345678901',
        },
        editorApiUrl: 'https://api.playrunner.test',
      },
    ),
    [
      { name: 'KEEP_ME', value: 'preserved' },
      { name: 'EDITOR_API_URL', value: 'https://api.playrunner.test' },
      {
        name: 'PLAYRUNNER_ORCHESTRATOR_AUTH_MODE',
        value: 'gcp_identity',
      },
      {
        name: 'PLAYRUNNER_ORCHESTRATOR_IDENTITY_AUDIENCE',
        value: 'https://orchestrator.example.run.app',
      },
      {
        name: 'PLAYRUNNER_ORCHESTRATOR_CALLER_SERVICE_ACCOUNT_EMAIL',
        value: 'playrunner-api@example.iam.gserviceaccount.com',
      },
      {
        name: 'PLAYRUNNER_ORCHESTRATOR_CALLER_SERVICE_ACCOUNT_SUBJECT',
        value: '123456789012345678901',
      },
    ],
  );
});

test('removes public IAM principals and preserves policy etag and private bindings', () => {
  const etag = Buffer.from('policy-etag');
  const policy = withPrivateOrchestratorInvokerPolicy(
    {
      bindings: [
        {
          members: [
            'allUsers',
            'serviceAccount:existing@example.iam.gserviceaccount.com',
          ],
          role: 'roles/run.invoker',
        },
        {
          members: ['allAuthenticatedUsers'],
          role: 'roles/example.publicRole',
        },
        {
          members: [
            'user:operator@example.com',
            'serviceAccount:playrunner-api@example.iam.gserviceaccount.com',
          ],
          role: 'roles/run.viewer',
        },
      ],
      etag,
      version: 3,
    },
    'playrunner-api@example.iam.gserviceaccount.com',
  );

  assert.equal(policy.etag, etag);
  assert.equal(policy.version, 3);
  assert.deepEqual(policy.bindings, [
    {
      members: [
        'serviceAccount:existing@example.iam.gserviceaccount.com',
        'serviceAccount:playrunner-api@example.iam.gserviceaccount.com',
      ],
      role: 'roles/run.invoker',
    },
    {
      members: ['user:operator@example.com'],
      role: 'roles/run.viewer',
    },
  ]);
});

test('sets exactly one trusted callback origin without dropping other service environment', () => {
  assert.deepEqual(
    withOrchestratorEditorApiEnvironment(
      [
        { name: 'KEEP_ME', value: 'preserved' },
        { name: 'EDITOR_API_URL', value: 'https://stale.test' },
        { name: 'EDITOR_API_URL', value: 'https://duplicate.test' },
      ],
      'https://api.playrunner.test',
    ),
    [
      { name: 'KEEP_ME', value: 'preserved' },
      { name: 'EDITOR_API_URL', value: 'https://api.playrunner.test' },
    ],
  );
});
