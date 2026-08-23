import assert from 'node:assert/strict';
import test from 'node:test';
import { ORCHESTRATOR_PORT } from '../config';
import {
  createLocalOrchestratorDockerArgs,
  getLocalOrchestratorRequestHeaders,
  isExpectedLocalOrchestrator,
  isExpectedLocalOrchestratorRunning,
  LOCAL_ORCHESTRATOR_AUTH_HEADER,
} from './orchestrator-runner';

const originalFetch = globalThis.fetch;

test('binds the privileged local orchestrator to loopback with a secret-free argv', () => {
  const args = createLocalOrchestratorDockerArgs();
  const token =
    getLocalOrchestratorRequestHeaders()[LOCAL_ORCHESTRATOR_AUTH_HEADER];

  assert.ok(args.includes(`127.0.0.1:${ORCHESTRATOR_PORT}:8080`));
  assert.ok(args.includes('PLAYRUNNER_ORCHESTRATOR_AUTH_TOKEN'));
  assert.equal(args.includes(token), false);
  assert.ok(token.length >= 43);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
});

test('hardens the privileged local orchestrator container', () => {
  const args = createLocalOrchestratorDockerArgs();
  assert.ok(args.includes('--pids-limit'));
  assert.ok(args.includes('--cap-drop'));
  assert.ok(args.includes('ALL'));
  assert.ok(args.includes('no-new-privileges'));
  assert.ok(args.includes('nofile=4096:4096'));
});

test('passes the detected local Docker platform to the orchestrator', () => {
  const args = createLocalOrchestratorDockerArgs('linux/arm64');
  assert.ok(args.includes('PLAYRUNNER_LOCAL_DOCKER_PLATFORM=linux/arm64'));
  assert.throws(
    () => createLocalOrchestratorDockerArgs('linux/riscv64'),
    /Unsupported local Docker platform/,
  );
});

test('rejects legacy runtime metadata that does not attest local authentication', () => {
  assert.equal(
    isExpectedLocalOrchestrator({
      eventTransport: 'pubsub',
      pubsubEmulatorHost:
        process.env.PUBSUB_EMULATOR_HOST_DOCKER ||
        `host.docker.internal:${process.env.PUBSUB_EMULATOR_PORT || 8084}`,
      runnerControl: 'pubsub',
      service: 'playrunner-orchestrator',
      workflowEventsTopic:
        process.env.GCP_PUBSUB_WORKFLOW_EVENTS_TOPIC ||
        'playrunner-workflow-events',
    }),
    false,
  );
});

test('does not reuse a legacy orchestrator that ignores the supplied auth token', async (context) => {
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/health')) return new Response('healthy');
    if (url.endsWith('/runtime')) {
      return Response.json({
        eventTransport: 'pubsub',
        localAuth: 'required',
        pubsubEmulatorHost:
          process.env.PUBSUB_EMULATOR_HOST_DOCKER ||
          `host.docker.internal:${process.env.PUBSUB_EMULATOR_PORT || 8084}`,
        runnerControl: 'pubsub',
        service: 'playrunner-orchestrator',
        workflowEventsTopic:
          process.env.GCP_PUBSUB_WORKFLOW_EVENTS_TOPIC ||
          'playrunner-workflow-events',
      });
    }
    return new Response(null, { status: 404 });
  };

  assert.equal(await isExpectedLocalOrchestratorRunning(), false);
});

test('accepts current runtime metadata only when an invalid token is rejected', async (context) => {
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const expectedToken =
    getLocalOrchestratorRequestHeaders()[LOCAL_ORCHESTRATOR_AUTH_HEADER];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/health')) return new Response('healthy');
    if (url.endsWith('/runtime')) {
      const headers = new Headers(init?.headers);
      if (headers.get(LOCAL_ORCHESTRATOR_AUTH_HEADER) !== expectedToken) {
        return Response.json({ error: 'unauthorized' }, { status: 401 });
      }
      return Response.json({
        eventTransport: 'pubsub',
        localAuth: 'required',
        pubsubEmulatorHost:
          process.env.PUBSUB_EMULATOR_HOST_DOCKER ||
          `host.docker.internal:${process.env.PUBSUB_EMULATOR_PORT || 8084}`,
        runnerControl: 'pubsub',
        service: 'playrunner-orchestrator',
        workflowEventsTopic:
          process.env.GCP_PUBSUB_WORKFLOW_EVENTS_TOPIC ||
          'playrunner-workflow-events',
      });
    }
    return new Response(null, { status: 404 });
  };

  assert.equal(await isExpectedLocalOrchestratorRunning(), true);
});
