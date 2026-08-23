import assert from 'node:assert/strict';
import test from 'node:test';
import { runCli } from './run.js';

const definition = {
  project: { key: 'demo', title: 'Demo' },
  workflow: {
    key: 'demo-tests',
    title: 'Demo tests',
    nodes: [
      {
        config: {
          skillSources: [
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
          ],
        },
        id: 'agent-container',
        nodeType: 'agent-container',
      },
    ],
    connections: [],
  },
};

test('creates a workflow from a declarative file', async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const stdout: string[] = [];
  const exitCode = await runCli(
    ['workflow', 'create', '--file', 'workflow.json'],
    {
      env: {
        PLAYRUNNER_API_KEY: 'pr_live_secret',
        PLAYRUNNER_URL: 'https://playrunner.test',
      },
      fetch: async (input, init) => {
        calls.push({ input: String(input), init });
        return new Response(
          JSON.stringify({
            created: true,
            editorPath: '/workflow/workflow-1',
            projectId: 'project-1',
            workflowId: 'workflow-1',
          }),
          { status: 201 },
        );
      },
      readFile: async () => JSON.stringify(definition),
      stderr: () => undefined,
      stdout: (line) => stdout.push(line),
    },
  );

  assert.equal(exitCode, 0);
  assert.equal(
    calls[0].input,
    'https://playrunner.test/api/v1/workflows/definitions/demo-tests',
  );
  assert.equal(calls[0].init?.method, 'PUT');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), definition);
  assert.deepEqual(
    (
      JSON.parse(String(calls[0].init?.body)).workflow.nodes[0].config as {
        skillSources: unknown;
      }
    ).skillSources,
    definition.workflow.nodes[0].config.skillSources,
  );
  assert.match(
    stdout.join('\n'),
    /https:\/\/playrunner\.test\/workflow\/workflow-1/,
  );
});

test('does not send an invalid definition', async () => {
  let requested = false;
  const stderr: string[] = [];
  const exitCode = await runCli(
    ['workflow', 'create', '--file', 'workflow.json'],
    {
      env: {
        PLAYRUNNER_API_KEY: 'pr_live_secret',
        PLAYRUNNER_URL: 'https://playrunner.test',
      },
      fetch: async () => {
        requested = true;
        return new Response();
      },
      readFile: async () => JSON.stringify({ project: definition.project }),
      stderr: (line) => stderr.push(line),
      stdout: () => undefined,
    },
  );

  assert.equal(exitCode, 2);
  assert.equal(requested, false);
  assert.match(stderr[0], /workflow\.key/);
});
