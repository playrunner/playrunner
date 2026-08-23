import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  executeWorkflow,
  environmentVariableFromTemplate,
  redactSensitivePayload,
  resolveAgentMemory,
  resolveCiChangeContext,
  resolveEditorApiOrigin,
} from '../index';
import { orchestratorRuntime } from './index';
import {
  createBotPullRequestWorkflowEvent,
  createLocalAgentDockerInvocation,
  MAX_AGENT_PAYLOAD_BYTES,
  validateAgentExecutionResult,
} from './agent-local';
import type { AgentExecutionRequest, AgentExecutionResult } from './contracts';
import { createPubSubAuthorizationHeaders } from './pubsub-runner-control';

const originalFetch = globalThis.fetch;
const originalPubSubEmulatorHost = process.env.PUBSUB_EMULATOR_HOST;
const originalEditorApiUrl = process.env.EDITOR_API_URL;

let capturedRequest: AgentExecutionRequest | undefined;
let cleanupCalls = 0;
let completionError: Error | undefined;

orchestratorRuntime.agentExecution.register([
  {
    supports: (cloudProvider) => cloudProvider === 'TEST_AGENT',
    prepare: async (request) => {
      capturedRequest = request;
      return {
        cleanup: async () => {
          cleanupCalls += 1;
        },
        start: async () => {},
        waitForCompletion: async (): Promise<AgentExecutionResult> => {
          if (completionError) throw completionError;
          return { outcome: 'success', output: { status: 'passed' } };
        },
        waitUntilReady: async () => {},
      };
    },
  },
]);

beforeEach(() => {
  process.env.EDITOR_API_URL = 'http://editor-api.test';
});

afterEach(() => {
  capturedRequest = undefined;
  cleanupCalls = 0;
  completionError = undefined;
  globalThis.fetch = originalFetch;
  if (originalPubSubEmulatorHost === undefined) {
    delete process.env.PUBSUB_EMULATOR_HOST;
  } else {
    process.env.PUBSUB_EMULATOR_HOST = originalPubSubEmulatorHost;
  }
  if (originalEditorApiUrl === undefined) delete process.env.EDITOR_API_URL;
  else process.env.EDITOR_API_URL = originalEditorApiUrl;
});

function agentRequest(
  overrides: Partial<AgentExecutionRequest> = {},
): AgentExecutionRequest {
  return {
    agent: { config: {}, nodeId: 'codex', nodeType: 'codex-cli' },
    config: { cpu: 2, memory: 4 },
    envKeys: ['OPENAI_API_KEY'],
    globalEnvVars: { OPENAI_API_KEY: 'openai-secret' },
    nodeId: 'agent-node',
    nodeOutputs: { node_context: { requirement: 'checkout' } },
    publishEvent: async () => {},
    publishLog: async () => {},
    registerActiveProcess: () => {},
    reqBody: {
      settings: { github: { accessToken: 'github-secret' } },
    },
    runtime: {
      cloudProvider: 'LOCAL_RUNNER',
      editorApiUrl: 'http://editor-api.test',
      executionAuthToken: 'execution-secret',
      nodeId: 'agent-node',
      testId: 'execution-1',
      workflowId: 'workflow-1',
    },
    validators: [{ config: {}, nodeId: 'validator', nodeType: 'validator' }],
    ...overrides,
  };
}

function workflowRequest(testId: string) {
  return {
    bucketName: 'test-artifacts',
    cloudProvider: 'TEST_AGENT',
    connections: [
      {
        role: 'execution',
        sourceId: 'context',
        targetId: 'agent-container',
        type: 'sequential',
      },
      {
        attachmentPort: 'agent',
        role: 'attachment',
        sourceId: 'codex',
        targetId: 'agent-container',
      },
      {
        attachmentPort: 'tool',
        role: 'attachment',
        sourceId: 'validator',
        targetId: 'agent-container',
      },
    ],
    editorApiUrl: 'http://editor-api.test',
    eventTransport: {
      projectId: 'test-project',
      topicName: 'workflow-events',
      type: 'gcp_pubsub',
    },
    executionAuthToken: 'execution-token',
    nodes: [
      {
        config: {
          variables: [
            {
              currentValue: 'Playrunner',
              enabled: true,
              key: 'TARGET_NAME',
            },
            {
              currentValue: 'openai-secret',
              enabled: true,
              key: 'OPENAI_API_KEY',
            },
          ],
        },
        id: 'context',
        label: 'Context',
        nodeType: 'environment',
        output: { requirement: 'declined checkout' },
      },
      {
        config: {
          envVars: ['TARGET_NAME'],
          metadata: { requirement: '{{node_context.requirement}}' },
          repository: 'playrunner/example',
          task: 'Test {{node_context.requirement}} for {{env.TARGET_NAME}} in {{workflow.definition.name}} using ticket {{workflow.inputs.ticket}}.',
        },
        id: 'agent-container',
        label: 'AI Container',
        nodeType: 'agent-container',
      },
      {
        config: {
          apiKey: '{{env.OPENAI_API_KEY}}',
          instructions:
            'Prioritize {{node_context.requirement}}. Ignore {{node_codex.mustNotLeak}}.',
        },
        id: 'codex',
        label: 'Codex CLI',
        nodeType: 'codex-cli',
        output: { mustNotLeak: 'attachment output' },
      },
      {
        config: {
          requirements: 'CHECKOUT: {{node_context.requirement}}',
        },
        id: 'validator',
        label: 'Validator',
        nodeType: 'validator',
      },
    ],
    settings: {},
    testId,
    workflow: {
      definition: { id: 'workflow-1', name: 'AI workflow' },
    },
    workflowId: 'workflow-1',
  };
}

describe('local AI Container execution', { concurrency: false }, () => {
  test('requires a complete Environment template for the Codex API key', () => {
    assert.equal(
      environmentVariableFromTemplate('{{env.OPENAI_API_KEY}}'),
      'OPENAI_API_KEY',
    );
    assert.equal(environmentVariableFromTemplate('OPENAI_API_KEY'), null);
    assert.equal(environmentVariableFromTemplate('env.OPENAI_API_KEY'), null);
    assert.equal(environmentVariableFromTemplate('sk-live-secret'), null);
  });

  test('redacts every selected Environment value regardless of its name', () => {
    assert.deepEqual(
      redactSensitivePayload({
        data: {
          environment: {
            DATABASE_URL: 'postgres://secret',
            ORDINARY_NAME: 'still-secret',
          },
        },
      }),
      {
        data: {
          environment: {
            DATABASE_URL: '[redacted]',
            ORDINARY_NAME: '[redacted]',
          },
        },
      },
    );
  });

  test('sends bearer credentials only to the canonical Google Pub/Sub API', () => {
    assert.deepEqual(
      createPubSubAuthorizationHeaders(
        'https://pubsub.googleapis.com/v1',
        'gcp-secret',
      ),
      { Authorization: 'Bearer gcp-secret' },
    );
    assert.deepEqual(
      createPubSubAuthorizationHeaders('http://attacker.test/v1', 'gcp-secret'),
      {},
    );
  });

  test('prefers and normalizes the server-owned callback origin', () => {
    assert.equal(
      resolveEditorApiOrigin(
        'https://attacker.test/callback',
        'https://api.playrunner.test/internal/path',
      ),
      'https://api.playrunner.test',
    );
    assert.throws(
      () => resolveEditorApiOrigin('https://attacker.test/callback', ''),
      /EDITOR_API_URL is required/,
    );
  });

  test('keeps payloads and Environment values out of Docker arguments', () => {
    const changeContext = {
      baseRef: 'main',
      baseSha: '1'.repeat(40),
      eventType: 'push' as const,
      headRef: 'feature/checkout',
      headSha: '2'.repeat(40),
      repository: 'playrunner/example',
    };
    const memory = {
      generatedTestFiles: ['tests/checkout.spec.ts'],
      lastProcessedHeadSha: '1'.repeat(40),
      repository: 'playrunner/example',
      schemaVersion: '1.0',
    };
    const invocation = createLocalAgentDockerInvocation(
      agentRequest({ changeContext, memory }),
      {
        controlSubscriptionName: 'agent-control',
        projectId: 'test-project',
        protocolToken: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        topicName: 'runner-events',
        type: 'gcp_pubsub',
      },
    );
    const payload = JSON.parse(invocation.payload);

    assert.ok(invocation.args.includes('-i'));
    assert.ok(invocation.args.includes('--init'));
    assert.ok(invocation.args.includes('--add-host'));
    assert.ok(invocation.args.includes('--pids-limit'));
    assert.ok(invocation.args.includes('--cap-drop'));
    assert.ok(invocation.args.includes('ALL'));
    const addedCapabilities = invocation.args.flatMap((argument, index) =>
      argument === '--cap-add' ? [invocation.args[index + 1]] : [],
    );
    assert.deepEqual(addedCapabilities, [
      'CHOWN',
      'DAC_OVERRIDE',
      'SETGID',
      'SETUID',
    ]);
    assert.ok(invocation.args.includes('no-new-privileges'));
    assert.ok(invocation.args.includes('seccomp=unconfined'));
    assert.ok(invocation.args.includes('nofile=4096:4096'));
    assert.equal(
      invocation.args.some((value) => value.startsWith('OPENAI_API_KEY=')),
      false,
    );
    assert.equal(invocation.environment.OPENAI_API_KEY, undefined);
    assert.doesNotMatch(
      invocation.args.join(' '),
      /openai-secret|github-secret|execution-secret|agent-control|PAYLOAD=/,
    );
    assert.equal(payload.environment.OPENAI_API_KEY, 'openai-secret');
    assert.deepEqual(payload.runnerControl, {
      controlSubscriptionName: 'agent-control',
      projectId: 'test-project',
      protocolToken: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      topicName: 'runner-events',
      type: 'gcp_pubsub',
    });
    assert.deepEqual(payload.nodeOutputs, {
      node_context: { requirement: 'checkout' },
    });
    assert.deepEqual(payload.changeContext, changeContext);
    assert.deepEqual(payload.memory, memory);
    assert.equal(payload.github.accessToken, 'github-secret');
    assert.equal(payload.runtime.executionAuthToken, 'execution-secret');
    assert.equal(payload.runtime.workflowId, 'workflow-1');
  });

  test('strictly validates trusted CI context and bounded memory', () => {
    const context = resolveCiChangeContext(
      {
        baseRef: 'main',
        baseSha: 'A'.repeat(40),
        eventType: 'pull_request',
        headRef: 'feature/checkout',
        headSha: 'B'.repeat(40),
        pullRequestNumber: 42,
        repository: 'playrunner/example',
      },
      'playrunner/example',
    );
    assert.equal(context?.baseSha, 'a'.repeat(40));
    assert.equal(context?.pullRequestNumber, 42);
    assert.equal(
      resolveCiChangeContext(
        { ...context, repository: 'Playrunner/Example' },
        'playrunner/example',
      )?.repository,
      'Playrunner/Example',
    );
    assert.throws(
      () =>
        resolveCiChangeContext(
          {
            ...context,
            repository: 'attacker/example',
          },
          'playrunner/example',
        ),
      /does not match the configured repository/,
    );
    assert.throws(
      () =>
        resolveCiChangeContext(
          { ...context, injected: true },
          'playrunner/example',
        ),
      /unknown fields/,
    );
    assert.deepEqual(resolveAgentMemory({ previous: { passed: true } }), {
      previous: { passed: true },
    });
    assert.throws(
      () => resolveAgentMemory({ value: 'x'.repeat(64 * 1024) }),
      /size or depth limit/,
    );
  });

  test('rejects Environment names reserved for runner control', () => {
    assert.throws(
      () =>
        createLocalAgentDockerInvocation(
          agentRequest({
            envKeys: ['DOCKER_HOST'],
            globalEnvVars: { DOCKER_HOST: 'tcp://attacker.test' },
          }),
          {
            controlSubscriptionName: 'agent-control',
            projectId: 'test-project',
            protocolToken: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            topicName: 'runner-events',
            type: 'gcp_pubsub',
          },
        ),
      /Reserved.*DOCKER_HOST/,
    );
  });

  test('rejects Environment values that cannot be passed safely to child processes', () => {
    assert.throws(
      () =>
        createLocalAgentDockerInvocation(
          agentRequest({
            envKeys: ['LARGE_VALUE'],
            globalEnvVars: { LARGE_VALUE: 'x'.repeat(64 * 1024 + 1) },
          }),
          {
            controlSubscriptionName: 'agent-control',
            projectId: 'test-project',
            protocolToken: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            topicName: 'runner-events',
            type: 'gcp_pubsub',
          },
        ),
      /Environment variable LARGE_VALUE exceeds .* bytes.*artifacts/i,
    );
  });

  test('rejects NUL characters before building the runner payload', () => {
    assert.throws(
      () =>
        createLocalAgentDockerInvocation(
          agentRequest({
            envKeys: ['INVALID_VALUE'],
            globalEnvVars: { INVALID_VALUE: 'before\0after' },
          }),
          {
            controlSubscriptionName: 'agent-control',
            projectId: 'test-project',
            protocolToken: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            topicName: 'runner-events',
            type: 'gcp_pubsub',
          },
        ),
      /variable INVALID_VALUE contains a NUL character/,
    );
  });

  test('rejects oversized inline workflow inputs before Docker starts', () => {
    assert.throws(
      () =>
        createLocalAgentDockerInvocation(
          agentRequest({
            nodeOutputs: { oversized: 'x'.repeat(MAX_AGENT_PAYLOAD_BYTES) },
          }),
          {
            controlSubscriptionName: 'agent-control',
            projectId: 'test-project',
            protocolToken: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            topicName: 'runner-events',
            type: 'gcp_pubsub',
          },
        ),
      /maximum inline payload size.*artifacts/i,
    );
  });

  test('normalizes AI Container resources to UI-supported values', () => {
    const invocation = createLocalAgentDockerInvocation(
      agentRequest({ config: { cpu: 3, memory: 7 } }),
      {
        controlSubscriptionName: 'agent-control',
        projectId: 'test-project',
        protocolToken: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        topicName: 'runner-events',
        type: 'gcp_pubsub',
      },
    );
    assert.deepEqual(
      invocation.args.slice(
        invocation.args.indexOf('--cpus'),
        invocation.args.indexOf('--memory') + 2,
      ),
      ['--cpus', '4', '--memory', '8g'],
    );
  });

  test('routes a loopback Pub/Sub emulator through the Docker host', () => {
    process.env.PUBSUB_EMULATOR_HOST = '127.0.0.1:8681';
    const invocation = createLocalAgentDockerInvocation(agentRequest(), {
      controlSubscriptionName: 'agent-control',
      projectId: 'test-project',
      protocolToken: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      topicName: 'runner-events',
      type: 'gcp_pubsub',
    });
    assert.ok(
      invocation.args.includes(
        'PUBSUB_EMULATOR_HOST=host.docker.internal:8681',
      ),
    );
  });

  test('accepts only schema-valid Pub/Sub results with consistent outcomes', () => {
    const result = validateAgentExecutionResult({
      outcome: 'success',
      output: {
        artifacts: {
          patch: '/outputs/patch',
          repositoryStatus: '/outputs/status',
          validationHistory: '/outputs/history',
        },
        attemptHistory: [{ attempt: 1 }],
        attempts: 1,
        patch: '',
        patchBytes: 0,
        patchTruncated: false,
        repositoryStatus: '',
        status: 'passed',
        stopReason: 'passed',
        validation: { passed: true, status: 'passed' },
      },
    });
    assert.equal(result.outcome, 'success');

    const pullRequest = {
      baseRef: 'feature/checkout',
      draft: true,
      headRef: 'playrunner/tests/aaaaaaaaaaaa-bbbbbbbbbbbbbbbb',
      number: 42,
      title: `test: generate coverage for ${'a'.repeat(40)}`,
      url: 'https://github.com/playrunner/example/pull/42',
    };
    const deliveredResult = validateAgentExecutionResult({
      ...result,
      output: {
        ...result.output,
        botDelivery: {
          branchName: pullRequest.headRef,
          changedFiles: ['tests/checkout.spec.ts'],
          commitSha: 'b'.repeat(40),
          developerHeadSha: 'a'.repeat(40),
          generatedTestFiles: ['tests/checkout.spec.ts'],
          pullRequest,
          status: 'created',
        },
        botPullRequest: {
          ...pullRequest,
          branchName: pullRequest.headRef,
          commitSha: 'b'.repeat(40),
          status: 'created',
        },
        memory: {
          botPullRequest: {
            headRef: pullRequest.headRef,
            headSha: 'b'.repeat(40),
            number: 42,
            url: pullRequest.url,
          },
          coverageGaps: [],
          generatedTestFiles: ['tests/checkout.spec.ts'],
          lastProcessedHeadSha: 'a'.repeat(40),
          repository: 'playrunner/example',
          schemaVersion: '1.0',
          validation: { status: 'passed', summary: 'Validation passed.' },
        },
        privateResult: {
          memory: 'must not reach the machine bot PR event',
          secret: 'github-secret',
        },
      },
    });
    assert.equal(deliveredResult.outcome, 'success');
    const botPullRequestEvent = createBotPullRequestWorkflowEvent(
      deliveredResult,
      {
        baseRef: 'main',
        baseSha: '1'.repeat(40),
        eventType: 'pull_request',
        headRef: 'feature/checkout',
        headSha: 'a'.repeat(40),
        repository: 'playrunner/example',
      },
    );
    assert.deepEqual(botPullRequestEvent, {
      baseRef: 'feature/checkout',
      draft: true,
      headRef: pullRequest.headRef,
      number: 42,
      repository: 'playrunner/example',
      status: 'created',
      type: 'bot_pull_request',
      url: pullRequest.url,
    });
    assert.doesNotMatch(
      JSON.stringify(botPullRequestEvent),
      /privateResult|memory|secret/,
    );
    assert.throws(
      () =>
        createBotPullRequestWorkflowEvent(deliveredResult, {
          baseRef: 'main',
          baseSha: '1'.repeat(40),
          eventType: 'pull_request',
          headRef: 'feature/checkout',
          headSha: 'a'.repeat(40),
          repository: 'someone/else',
        }),
      /does not match the immutable CI source/,
    );
    assert.throws(
      () =>
        createBotPullRequestWorkflowEvent(deliveredResult, {
          baseRef: 'main',
          baseSha: '1'.repeat(40),
          eventType: 'pull_request',
          headRef: 'other/base',
          headSha: 'a'.repeat(40),
          repository: 'playrunner/example',
        }),
      /does not match the immutable CI source/,
    );
    assert.throws(
      () =>
        createBotPullRequestWorkflowEvent(deliveredResult, {
          baseRef: 'main',
          baseSha: '1'.repeat(40),
          eventType: 'pull_request',
          headRef: 'feature/checkout',
          headSha: 'c'.repeat(40),
          repository: 'playrunner/example',
        }),
      /does not match the immutable CI source/,
    );
    assert.throws(
      () =>
        validateAgentExecutionResult({
          ...result,
          output: {
            ...result.output,
            memory: { transcript: 'untrusted model conversation' },
          },
        }),
      /delivery or memory schema is invalid/,
    );

    assert.throws(
      () =>
        validateAgentExecutionResult({
          outcome: 'error',
          output: {
            attemptHistory: [],
            attempts: 1,
            patch: '',
            patchBytes: 0,
            patchTruncated: false,
            repositoryStatus: '',
            status: 'failed',
            stopReason: 'max_attempts',
            validation: null,
          },
        }),
      /schema is invalid/,
    );
  });

  test('renders workflow inputs and always cleans up a successful runner', async () => {
    process.env.PUBSUB_EMULATOR_HOST = '127.0.0.1:8681';
    globalThis.fetch = async (input) =>
      String(input).startsWith('https://github.test/')
        ? Response.json({
            body: 'Checkout must reject a declined payment',
            html_url: 'https://github.com/playrunner/example/issues/46',
            number: 46,
            state: 'open',
            title: 'Declined checkout',
            url: 'https://api.github.com/repos/playrunner/example/issues/46',
          })
        : new Response('{}', { status: 200 });
    const request: any = workflowRequest('agent-success');
    request.connections.push({
      attachmentPort: 'tool',
      role: 'attachment',
      sourceId: 'github-requirement',
      targetId: 'agent-container',
    });
    request.nodes.push({
      config: {
        action: 'read',
        issueNumber: '{{workflow.inputs.ticket}}',
        repository: 'playrunner/example',
      },
      id: 'github-requirement',
      label: 'GitHub requirement',
      nodeType: 'github',
    });
    request.settings = {
      github: {
        accessToken: 'github-secret',
        apiBaseUrl: 'https://github.test',
      },
    };
    request.ci = {
      baseRef: 'main',
      baseSha: '1'.repeat(40),
      eventType: 'push',
      headRef: 'feature/checkout',
      headSha: '2'.repeat(40),
      repository: 'playrunner/example',
    };
    request.agentMemoryByNodeId = {
      'agent-container': {
        generatedTestFiles: ['tests/previous.spec.ts'],
        lastProcessedHeadSha: '1'.repeat(40),
        repository: 'playrunner/example',
        schemaVersion: '1.0',
      },
    };
    request.inputs = { ticket: '46' };
    request.acceptanceCriteria = ['Ticket #46 is the acceptance criteria'];

    await executeWorkflow(request);

    assert.ok(capturedRequest);
    assert.equal(
      capturedRequest.config.task,
      'Test declined checkout for Playrunner in AI workflow using ticket 46.',
    );
    assert.deepEqual(capturedRequest.config.metadata, {
      requirement: 'declined checkout',
    });
    assert.equal(
      capturedRequest.agent.config.instructions,
      'Prioritize declined checkout. Ignore .',
    );
    assert.equal(capturedRequest.agent.config.apiKeyEnvVar, 'OPENAI_API_KEY');
    assert.equal(Object.hasOwn(capturedRequest.agent.config, 'apiKey'), false);
    assert.equal(capturedRequest.agent.nodeId, 'codex');
    assert.equal(capturedRequest.validators[0]?.nodeId, 'validator');
    assert.equal(
      capturedRequest.validators[0]?.config.requirements,
      'CHECKOUT: declined checkout',
    );
    assert.equal(
      (capturedRequest.nodeOutputs.node_context as Record<string, unknown>)
        .requirement,
      'declined checkout',
    );
    assert.equal(
      (
        (
          capturedRequest.nodeOutputs['node_github-requirement'] as Record<
            string,
            unknown
          >
        ).acceptanceCriteria as Record<string, unknown>
      ).id,
      'playrunner/example#46',
    );
    assert.deepEqual(capturedRequest.requirements, [
      {
        body: 'Checkout must reject a declined payment',
        id: 'playrunner/example#46',
        source: 'github',
        title: 'Declined checkout',
        url: 'https://github.com/playrunner/example/issues/46',
      },
      {
        body: 'Ticket #46 is the acceptance criteria',
        id: 'CLI-1',
        source: 'workflow',
        title: 'Ticket #46 is the acceptance criteria',
      },
    ]);
    assert.deepEqual(capturedRequest.changeContext, request.ci);
    assert.deepEqual(
      capturedRequest.memory,
      request.agentMemoryByNodeId['agent-container'],
    );
    assert.deepEqual(
      new Set(capturedRequest.envKeys),
      new Set(['OPENAI_API_KEY', 'TARGET_NAME']),
    );
    assert.deepEqual(capturedRequest.runtime, {
      bucketName: 'test-artifacts',
      cloudProvider: 'TEST_AGENT',
      editorApiUrl: 'http://editor-api.test',
      executionAuthToken: 'execution-token',
      nodeId: 'agent-container',
      testId: 'agent-success',
      workflowId: 'workflow-1',
    });
    assert.equal(cleanupCalls, 1);
    assert.match(request.nodes[1].config.task, /{{node_context\.requirement}}/);
  });

  test('cleans up when AI Container completion fails', async () => {
    process.env.PUBSUB_EMULATOR_HOST = '127.0.0.1:8681';
    globalThis.fetch = async () => new Response('{}', { status: 200 });
    completionError = new Error('Agent completion failed.');

    await executeWorkflow(workflowRequest('agent-failure'));

    assert.equal(cleanupCalls, 1);
  });
});
