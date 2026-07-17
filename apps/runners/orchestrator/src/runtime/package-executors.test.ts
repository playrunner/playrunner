import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { createOrchestratorRegistry } from '@playrunner/integration-registry/orchestrator';
import type {
  NodeExecutionContext,
  OrchestratorIntegrationContribution,
} from '@playrunner/integration-sdk/orchestrator';
import { PackageExecutorRuntime } from './package-executors';
import {
  createDiscoveredOrchestratorRegistry,
  packageOrchestratorRegistry,
} from './discovered-orchestrator-registry';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function contribution(
  id: string,
  executors: OrchestratorIntegrationContribution['executors'],
): OrchestratorIntegrationContribution {
  return {
    contractVersion: 1,
    id,
    executors,
  };
}

function executionInput(overrides: Record<string, unknown> = {}) {
  return {
    executionId: 'execution-1',
    workflowId: 'workflow-1',
    node: {
      id: 'node-1',
      label: 'Test node',
      nodeType: 'provider',
      config: {},
    },
    settings: {},
    env: { NAME: 'Playrunner' },
    workflow: { run: { status: 'running' } },
    renderTemplate: (value: string) =>
      value.replace('{{env.NAME}}', 'Playrunner'),
    log: async () => {},
    ...overrides,
  };
}

describe('package orchestrator integration', { concurrency: false }, () => {
  describe('orchestrator registry validation and resolution', () => {
    const successExecutor = {
      nodeType: 'provider',
      execute: async () => ({ outcome: 'success' as const }),
    };

    test('rejects unsupported contract versions', () => {
      assert.throws(
        () =>
          createOrchestratorRegistry([
            {
              contractVersion: 2,
              id: 'provider',
              executors: [successExecutor],
            },
          ]),
        /Unsupported orchestrator contract version/,
      );
    });

    test('rejects malformed contributions', () => {
      assert.throws(
        () =>
          createOrchestratorRegistry([
            { contractVersion: 1, id: '', executors: [] },
          ]),
        /id must be a non-empty string/,
      );
      assert.throws(
        () =>
          createOrchestratorRegistry([
            { contractVersion: 1, id: 'provider', executors: [{}] },
          ]),
        /nodeType must be a non-empty string/,
      );
    });

    test('rejects package manifest and contribution id mismatches', () => {
      assert.throws(
        () =>
          createDiscoveredOrchestratorRegistry([
            {
              packageName: '@playrunner/provider',
              integrationId: 'manifest-provider',
              contribution: contribution('exported-provider', [
                successExecutor,
              ]),
            },
          ]),
        /declares id "manifest-provider".*contribution has id "exported-provider"/,
      );
    });

    test('rejects duplicate contribution ids and executor keys', () => {
      assert.throws(
        () =>
          createOrchestratorRegistry([
            contribution('provider', [successExecutor]),
            contribution('provider', [
              { ...successExecutor, nodeType: 'other-provider' },
            ]),
          ]),
        /Duplicate orchestrator contribution id "provider"/,
      );

      assert.throws(
        () =>
          createOrchestratorRegistry([
            contribution('provider-one', [successExecutor]),
            contribution('provider-two', [successExecutor]),
          ]),
        /Duplicate orchestrator executor/,
      );
    });

    test('rejects multiple defaults and resolves actions deterministically', () => {
      assert.throws(
        () =>
          createOrchestratorRegistry([
            contribution('provider', [
              { ...successExecutor, action: 'create', default: true },
              { ...successExecutor, action: 'update', default: true },
            ]),
          ]),
        /Multiple default orchestrator executors/,
      );

      assert.equal(
        packageOrchestratorRegistry.resolve('jira')?.executor.action,
        'create',
      );
      assert.equal(
        packageOrchestratorRegistry.resolve('jira', 'update')?.executor.action,
        'update',
      );
      assert.equal(
        packageOrchestratorRegistry.resolve('jira', 'unsupported'),
        undefined,
      );
    });
  });

  describe('package executor host runtime', () => {
    test('preflights canonical nodeType and unsupported actions', () => {
      const runtime = new PackageExecutorRuntime({ timeoutMs: 1000 });

      runtime.preflight([
        { id: 'environment', nodeType: 'environment' },
        { id: 'playwright', nodeType: 'playwright' },
        { id: 'schedule', nodeType: 'schedule' },
        { id: 'github', nodeType: 'github' },
        { id: 'slack', nodeType: 'slack' },
        { id: 'jira', nodeType: 'jira', config: { action: 'update' } },
      ]);

      assert.throws(
        () =>
          runtime.preflight([
            {
              id: 'jira',
              label: 'Jira',
              nodeType: 'jira',
              config: { action: 'delete' },
            },
          ]),
        /executor not installed\/registered.*action "delete"/i,
      );
      assert.throws(
        () => runtime.preflight([{ id: 'code', nodeType: 'javascript' }]),
        /executor not installed\/registered.*"javascript"/i,
      );
      assert.throws(
        () => runtime.preflight([{ id: 'slack', label: 'slack' }]),
        /missing its persisted nodeType.*does not fall back/i,
      );
    });

    test('passes only provider-scoped readonly settings and cleans up after success', async () => {
      let receivedContext: NodeExecutionContext | undefined;
      const registry = createOrchestratorRegistry([
        contribution('provider-credentials', [
          {
            nodeType: 'provider',
            execute: async (context) => {
              receivedContext = context;
              return { outcome: 'success', output: { ok: true } };
            },
          },
        ]),
      ]);
      const runtime = new PackageExecutorRuntime({ registry, timeoutMs: 1000 });

      const result = await runtime.execute(
        executionInput({
          settings: {
            'provider-credentials': { token: 'provider-token' },
            unrelated: { token: 'must-not-be-visible' },
          },
        }),
      );

      assert.deepEqual(result, { outcome: 'success', output: { ok: true } });
      assert.deepEqual(receivedContext?.settings, {
        token: 'provider-token',
      });
      assert.equal(Object.isFrozen(receivedContext?.settings), true);
      assert.equal(Object.isFrozen(receivedContext?.node.config), true);
      assert.deepEqual(runtime.diagnostics().activeExecutions, []);
    });

    test('cleans up active tracking when validation or execution throws', async () => {
      const registry = createOrchestratorRegistry([
        contribution('provider', [
          {
            nodeType: 'provider',
            validate: async () => {
              throw new Error('Safe validation failure.');
            },
            execute: async () => ({ outcome: 'success' }),
          },
        ]),
      ]);
      const runtime = new PackageExecutorRuntime({ registry, timeoutMs: 1000 });

      await assert.rejects(
        runtime.execute(executionInput()),
        /Safe validation failure/,
      );
      assert.deepEqual(runtime.diagnostics().activeExecutions, []);
    });

    test('cancels identical node ids independently by execution id', async () => {
      const registry = createOrchestratorRegistry([
        contribution('provider', [
          {
            nodeType: 'provider',
            execute: async () => new Promise(() => {}),
          },
        ]),
      ]);
      const runtime = new PackageExecutorRuntime({
        registry,
        timeoutMs: 10_000,
      });

      const first = runtime.execute(
        executionInput({ executionId: 'execution-1' }),
      );
      const second = runtime.execute(
        executionInput({ executionId: 'execution-2' }),
      );
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(runtime.diagnostics().activeExecutions.length, 2);
      assert.equal(
        runtime.cancel({ executionId: 'execution-1', nodeId: 'node-1' }),
        1,
      );
      await assert.rejects(first, /Node executor was cancelled/);
      assert.deepEqual(
        runtime
          .diagnostics()
          .activeExecutions.map((active) => active.executionId),
        ['execution-2'],
      );

      assert.equal(
        runtime.cancel({ executionId: 'execution-2', nodeId: 'node-1' }),
        1,
      );
      await assert.rejects(second, /Node executor was cancelled/);
      assert.deepEqual(runtime.diagnostics().activeExecutions, []);
    });

    test('aborts timed-out executors and always releases bookkeeping', async () => {
      const registry = createOrchestratorRegistry([
        contribution('provider', [
          {
            nodeType: 'provider',
            execute: async () => new Promise(() => {}),
          },
        ]),
      ]);
      const runtime = new PackageExecutorRuntime({ registry, timeoutMs: 10 });

      await assert.rejects(
        runtime.execute(executionInput()),
        /Node executor timed out after 10ms/,
      );
      assert.deepEqual(runtime.diagnostics().activeExecutions, []);
    });
  });

  describe('bundled provider executors', () => {
    test('executes Slack webhook and Bot API requests', async () => {
      const requests: Array<{ input: string; init?: RequestInit }> = [];
      globalThis.fetch = async (input, init) => {
        requests.push({ input: String(input), init });
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      };
      const runtime = new PackageExecutorRuntime({ timeoutMs: 1000 });

      await runtime.execute(
        executionInput({
          node: {
            id: 'slack-webhook',
            nodeType: 'slack',
            config: { message: 'Hello {{env.NAME}}', username: 'Runner' },
          },
          settings: { slack: { webhookUrl: 'https://hooks.slack.test/abc' } },
        }),
      );
      await runtime.execute(
        executionInput({
          node: {
            id: 'slack-bot',
            nodeType: 'slack',
            config: { channel: 'C123', message: 'Hello' },
          },
          settings: { slack: { accessToken: 'xoxb-secret' } },
        }),
      );

      assert.equal(requests[0]?.input, 'https://hooks.slack.test/abc');
      assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
        text: 'Hello Playrunner',
        username: 'Runner',
      });
      assert.equal(
        requests[1]?.input,
        'https://slack.com/api/chat.postMessage',
      );
      assert.equal(
        (requests[1]?.init?.headers as Record<string, string>).Authorization,
        'Bearer xoxb-secret',
      );
    });

    test('executes default Jira create and explicit update requests', async () => {
      const requests: Array<{ input: string; init?: RequestInit }> = [];
      globalThis.fetch = async (input, init) => {
        requests.push({ input: String(input), init });
        return new Response(JSON.stringify({ key: 'PR-18' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      };
      const runtime = new PackageExecutorRuntime({ timeoutMs: 1000 });
      const jiraSettings = { jira: { accessToken: 'jira-secret' } };

      await runtime.execute(
        executionInput({
          node: {
            id: 'jira-create',
            nodeType: 'jira',
            config: {
              cloudId: 'cloud-1',
              projectId: '10000',
              issueType: 'Task',
              summary: 'Created by {{env.NAME}}',
            },
          },
          settings: jiraSettings,
        }),
      );
      await runtime.execute(
        executionInput({
          node: {
            id: 'jira-update',
            nodeType: 'jira',
            config: {
              action: 'update',
              cloudId: 'cloud-1',
              issueKey: 'PR-18',
              summary: 'Updated',
            },
          },
          settings: jiraSettings,
        }),
      );

      assert.equal(
        requests[0]?.input,
        'https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/issue',
      );
      assert.equal(requests[0]?.init?.method, 'POST');
      assert.equal(
        JSON.parse(String(requests[0]?.init?.body)).fields.summary,
        'Created by Playrunner',
      );
      assert.equal(
        requests[1]?.input,
        'https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/issue/PR-18',
      );
      assert.equal(requests[1]?.init?.method, 'PUT');
    });

    test('does not expose raw provider response bodies in failures', async () => {
      globalThis.fetch = async () =>
        new Response('secret-provider-response', { status: 500 });
      const runtime = new PackageExecutorRuntime({ timeoutMs: 1000 });

      await assert.rejects(
        runtime.execute(
          executionInput({
            node: {
              id: 'slack-webhook',
              nodeType: 'slack',
              config: { message: 'Hello' },
            },
            settings: {
              slack: { webhookUrl: 'https://hooks.slack.test/secret' },
            },
          }),
        ),
        (error: Error) => {
          assert.match(error.message, /^Slack action failed:/);
          assert.doesNotMatch(error.message, /secret-provider-response/);
          assert.doesNotMatch(error.message, /hooks\.slack\.test/);
          return true;
        },
      );
    });

    test('reports a sanitized Slack Bot API failure', async () => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: 'channel_not_found',
            sensitiveDetails: 'must-not-leak',
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          },
        );
      const runtime = new PackageExecutorRuntime({ timeoutMs: 1000 });

      await assert.rejects(
        runtime.execute(
          executionInput({
            node: {
              id: 'slack-bot-failure',
              nodeType: 'slack',
              config: { channel: 'C404', message: 'Hello' },
            },
            settings: { slack: { accessToken: 'xoxb-secret' } },
          }),
        ),
        (error: Error) => {
          assert.equal(
            error.message,
            'Slack action failed: Slack API error: channel_not_found',
          );
          assert.doesNotMatch(error.message, /must-not-leak|xoxb-secret/);
          return true;
        },
      );
    });

    test('reports sanitized Jira create and update failures', async () => {
      globalThis.fetch = async () =>
        new Response('jira-secret-response', { status: 500 });
      const runtime = new PackageExecutorRuntime({ timeoutMs: 1000 });
      const jiraSettings = { jira: { accessToken: 'jira-secret-token' } };

      for (const config of [
        {
          cloudId: 'cloud-1',
          projectId: '10000',
          issueType: 'Task',
          summary: 'Create failure',
        },
        {
          action: 'update',
          cloudId: 'cloud-1',
          issueKey: 'PR-404',
          summary: 'Update failure',
        },
      ]) {
        await assert.rejects(
          runtime.execute(
            executionInput({
              node: {
                id: `jira-${config.action ?? 'create'}-failure`,
                nodeType: 'jira',
                config,
              },
              settings: jiraSettings,
            }),
          ),
          (error: Error) => {
            assert.equal(
              error.message,
              'Jira Action failed: Jira API returned 500: request failed',
            );
            assert.doesNotMatch(
              error.message,
              /jira-secret-response|jira-secret-token/,
            );
            return true;
          },
        );
      }
    });
  });

  describe('workflow host finalization', () => {
    test('publishes one terminal node state when a package executor throws', async () => {
      const previousPremium = process.env.ENABLE_PREMIUM;
      const previousPubSubEmulator = process.env.PUBSUB_EMULATOR_HOST;
      const publishedEvents: Record<string, unknown>[] = [];

      process.env.ENABLE_PREMIUM = 'false';
      process.env.PUBSUB_EMULATOR_HOST = '127.0.0.1:8681';
      globalThis.fetch = async (_input, init) => {
        const requestBody = JSON.parse(String(init?.body)) as {
          messages: Array<{ data: string }>;
        };
        for (const message of requestBody.messages) {
          publishedEvents.push(
            JSON.parse(Buffer.from(message.data, 'base64').toString('utf8')),
          );
        }
        return new Response('{}', { status: 200 });
      };

      try {
        const { executeWorkflow } = await import('../index');
        await executeWorkflow({
          cloudProvider: 'GCP',
          connections: [],
          eventTransport: {
            projectId: 'test-project',
            topicName: 'workflow-events',
            type: 'gcp_pubsub',
          },
          executionAuthToken: 'execution-token',
          nodes: [
            {
              config: {},
              id: 'slack-node',
              label: 'Slack',
              nodeType: 'slack',
            },
          ],
          settings: {},
          testId: 'execution-finalization',
          workflow: {
            definition: { id: 'workflow-1', name: 'Finalization test' },
          },
          workflowId: 'workflow-1',
        });
      } finally {
        if (previousPremium === undefined) {
          delete process.env.ENABLE_PREMIUM;
        } else {
          process.env.ENABLE_PREMIUM = previousPremium;
        }
        if (previousPubSubEmulator === undefined) {
          delete process.env.PUBSUB_EMULATOR_HOST;
        } else {
          process.env.PUBSUB_EMULATOR_HOST = previousPubSubEmulator;
        }
      }

      const nodeStates = publishedEvents.filter(
        (event) => event.type === 'node_state' && event.nodeId === 'slack-node',
      );
      assert.deepEqual(
        nodeStates.map((event) => event.state),
        ['running', 'error'],
      );
      assert.equal(
        nodeStates.filter((event) => event.state === 'error').length,
        1,
      );
      assert.equal(
        publishedEvents.filter((event) => event.type === 'workflow_failed')
          .length,
        1,
      );
    });
  });
});
