import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deviceRunnerPayload,
  DevicePlaywrightExecutionBackend,
} from './playwright-device';
import { createRunnerControlClient } from '../../../shared/runner-control';
import { prewarmGcpPlaywrightRunners } from '../../../../../packages/gcp/src/api-runtime/playwright-prewarm';
const request = {
  reqBody: { localWorker: { source: 'workspace' } },
  envKeys: ['BASE_URL'],
  globalEnvVars: {
    BASE_URL: 'http://host.docker.internal:3000',
    OTHER_SECRET: 'do-not-forward',
  },
  payloadData: {
    data: {
      executionAuthToken: 'full-run-secret',
      testId: 'run',
      nodeId: 'node',
    },
    settings: { gcp: { accessToken: 'cloud-secret' } },
    github: { accessToken: 'repo-secret' },
  },
} as any;
test('device payload excludes cloud credentials and unselected secrets', () => {
  const payload = deviceRunnerPayload(request, {
    protocolToken: 'step-secret',
  });
  const serialized = JSON.stringify(payload);
  for (const secret of [
    'full-run-secret',
    'cloud-secret',
    'repo-secret',
    'do-not-forward',
  ])
    assert.ok(!serialized.includes(secret));
  assert.equal(
    payload.data.environment.BASE_URL,
    'http://host.docker.internal:3000',
  );
});
test('local target prevents hosted prewarming without calling a provider', async () => {
  assert.deepEqual(
    await prewarmGcpPlaywrightRunners({
      body: {
        localWorker: { deviceId: 'device' },
        nodes: [{ nodeType: 'playwright' }],
      },
    } as any),
    {},
  );
});
test('unsupported local runtimes fail before provisioning control channels', async () => {
  await assert.rejects(
    () =>
      new DevicePlaywrightExecutionBackend().prepare({
        ...request,
        runtime: 'python',
      }),
    /TypeScript/,
  );
});
test('existing signed runner protocol publishes through a job-scoped relay', async () => {
  let observed: any;
  const client = createRunnerControlClient({
    config: {
      type: 'gcp_pubsub',
      projectId: 'project',
      topicName: 'topic',
      controlSubscriptionName: 'control',
      protocolToken: 'A'.repeat(43),
      relay: { url: 'https://cloud.test/job/pubsub', token: 'local-grant' },
    },
    executionId: 'run',
    nodeId: 'node',
    fetcher: async (url, init) => {
      observed = { url, init };
      return new Response('{}', { status: 200 });
    },
  });
  await client.publishStatus('ready');
  assert.equal(
    observed.url,
    'https://cloud.test/job/pubsub/projects/project/topics/topic:publish',
  );
  assert.equal(observed.init.headers.Authorization, 'Bearer local-grant');
  const message = JSON.parse(observed.init.body).messages[0];
  const event = JSON.parse(Buffer.from(message.data, 'base64').toString());
  assert.equal(event.nodeId, 'node');
  assert.ok(event.protocolSignature);
});
