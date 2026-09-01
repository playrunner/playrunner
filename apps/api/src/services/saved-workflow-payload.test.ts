import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSavedWorkflowExecutionBody } from './saved-workflow-payload';

test('saved workflow executions publish events under the API execution ID', () => {
  const body = buildSavedWorkflowExecutionBody({
    body: {
      agentMemoryByNodeId: { agent: { summary: 'untrusted override' } },
      authenticationStatesByNodeId: { node: { cookies: ['untrusted'] } },
      authenticationProfileNodeIds: ['node'],
      cloudProvider: 'GCP',
      nodes: ['untrusted override'],
      testId: 'untrusted override',
    },
    executionId: 'execution-123',
    triggerData: {},
    triggerName: 'ci',
    workflow: {
      cloudProvider: 'LOCAL_RUNNER',
      concurrency: 1,
      connections: [{ sourceId: 'a', targetId: 'b' }],
      id: 'workflow-123',
      nodes: [{ id: 'a' }, { id: 'b' }],
      title: 'CI workflow',
    },
  });

  assert.equal(body.testId, 'execution-123');
  assert.equal(body.cloudProvider, 'LOCAL_RUNNER');
  assert.equal(Object.hasOwn(body, 'agentMemoryByNodeId'), false);
  assert.equal(Object.hasOwn(body, 'authenticationStatesByNodeId'), false);
  assert.equal(Object.hasOwn(body, 'authenticationProfileNodeIds'), false);
  assert.deepEqual(body.nodes, [{ id: 'a' }, { id: 'b' }]);
  assert.equal(body.workflow.run.trigger, 'ci');
});

test('saved workflow executions inject only server-owned agent memory', () => {
  const ci = {
    baseRef: 'main',
    baseSha: 'a'.repeat(40),
    eventType: 'push',
    headRef: 'main',
    headSha: 'b'.repeat(40),
    repository: 'playrunner/playrunner',
  };
  const body = buildSavedWorkflowExecutionBody({
    agentMemoryByNodeId: {
      agent: { schemaVersion: 1, summary: 'Prior CI run context.' },
    },
    body: {
      agentMemoryByNodeId: { agent: { summary: 'client override' } },
      ci,
    },
    executionId: 'execution-memory',
    triggerData: ci,
    triggerName: 'ci',
    workflow: {
      cloudProvider: 'LOCAL_RUNNER',
      concurrency: 1,
      connections: [],
      id: 'workflow-memory',
      nodes: [{ id: 'agent' }],
      title: 'Memory workflow',
    },
  });

  assert.deepEqual(body.agentMemoryByNodeId, {
    agent: { schemaVersion: 1, summary: 'Prior CI run context.' },
  });
  assert.deepEqual(body.ci, ci);
  assert.deepEqual(body.trigger, ci);
  assert.deepEqual(body.workflow.trigger, ci);
});

test('non-CI saved executions receive only server-owned agent memory', () => {
  const body = buildSavedWorkflowExecutionBody({
    agentMemoryByNodeId: {
      agent: { schemaVersion: 1, summary: 'server memory' },
    },
    body: {
      agentMemoryByNodeId: { agent: { summary: 'client memory' } },
      ci: { headSha: 'untrusted' },
      webhookInput: 'preserved',
    },
    executionId: 'execution-webhook',
    triggerData: { webhookInput: 'preserved' },
    triggerName: 'webhook',
    workflow: {
      cloudProvider: 'LOCAL_RUNNER',
      concurrency: 1,
      connections: [],
      id: 'workflow-webhook',
      nodes: [{ id: 'agent' }],
      title: 'Webhook workflow',
    },
  });

  assert.equal(Object.hasOwn(body, 'ci'), false);
  assert.deepEqual(body.agentMemoryByNodeId, {
    agent: { schemaVersion: 1, summary: 'server memory' },
  });
  assert.equal(body.webhookInput, 'preserved');
  assert.equal(body.workflow.run.trigger, 'webhook');
});

test('saved workflow executions preserve registered cloud providers', () => {
  const body = buildSavedWorkflowExecutionBody({
    executionId: 'execution-456',
    triggerData: {},
    triggerName: 'ci',
    workflow: {
      cloudProvider: 'PLAYRUNNER_CLOUD',
      concurrency: null,
      connections: [],
      id: 'workflow-456',
      nodes: [],
      title: 'Hosted workflow',
    },
  });

  assert.equal(body.cloudProvider, 'PLAYRUNNER_CLOUD');
  assert.equal(body.workflow.run.runner, 'PLAYRUNNER_CLOUD');
});

test('saved workflow executions preserve AI Container skill sources', () => {
  const skillSources = [
    {
      id: 'project-skills',
      path: '.agents/skills',
      type: 'project',
    },
    {
      id: 'shared-skills',
      path: 'skills/testing',
      ref: 'main',
      type: 'github',
      url: 'https://github.com/playrunner/agent-skills.git',
    },
  ];
  const body = buildSavedWorkflowExecutionBody({
    executionId: 'execution-skills',
    triggerData: {},
    triggerName: 'cli',
    workflow: {
      cloudProvider: 'LOCAL_RUNNER',
      concurrency: null,
      connections: [],
      id: 'workflow-skills',
      nodes: [
        {
          config: { skillSources },
          id: 'agent-container',
          nodeType: 'agent-container',
        },
      ],
      title: 'Skills workflow',
    },
  });

  assert.deepEqual(
    (
      (body.nodes[0] as Record<string, unknown>).config as Record<
        string,
        unknown
      >
    ).skillSources,
    skillSources,
  );
});
