import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRegressionExecution } from './regression-execution';
import { captureExecutionDefinition } from './execution-definition';

const request = {
  version: 1,
  mode: 'affected',
  sources: [
    {
      repository: 'example/ui',
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
    },
  ],
};
const policy = {
  version: 1,
  repositories: [
    { repository: 'example/ui' },
    { repository: 'example/portal', revision: 'c'.repeat(40) },
  ],
  dependencies: [
    {
      source: { repository: 'example/ui', path: 'src/select.ts' },
      consumer: { repository: 'example/portal', path: 'src/settings.ts' },
    },
  ],
  journeys: [
    {
      id: 'settings',
      title: 'Account settings',
      sources: [{ repository: 'example/portal', path: 'src/settings.ts' }],
      tests: [{ file: 'tests/settings.spec.ts' }],
    },
  ],
};
const nodes = [
  {
    id: 'checks',
    nodeType: 'playwright',
    config: {
      repository: 'example/tests.git',
      regression: policy,
      token: 'must-not-be-captured',
    },
  },
];

test('saved policies allow shared-library impact without accepting caller-selected tests', () => {
  const result = validateRegressionExecution({ regression: request }, nodes)!;
  assert.deepEqual(result.request, request);
  assert.deepEqual(result.policies.checks, policy);
  assert.throws(
    () =>
      validateRegressionExecution(
        { regression: { ...request, tests: [] } },
        nodes,
      ),
    /unknown|unsupported|unexpected/i,
  );
  assert.throws(
    () =>
      validateRegressionExecution(
        {
          regression: {
            ...request,
            sources: [{ ...request.sources[0], repository: 'other/private' }],
          },
        },
        nodes,
      ),
    /not configured/,
  );
});

test('missing mapping remains a valid request for a conservative full-suite fallback', () => {
  const result = validateRegressionExecution(
    {
      regression: {
        ...request,
        sources: [{ ...request.sources[0], repository: 'example/tests' }],
      },
    },
    [
      {
        ...nodes[0],
        config: { repository: 'example/tests.git' },
      },
    ],
  )!;
  assert.equal(Object.keys(result.policies).length, 0);
  assert.throws(
    () =>
      validateRegressionExecution({ regression: request }, [
        {
          ...nodes[0],
          config: { ...nodes[0].config, regression: { version: 999 } },
        },
      ]),
    /version|regression/i,
  );
});

test('unsupported sources and runtimes fail before provisioning a runner', () => {
  for (const config of [
    { action: 'run', testScript: 'test()' },
    { action: 'upload' },
    { action: 'workspace' },
    { action: 'clone', repository: 'example/tests', testLanguage: 'python' },
    { action: 'clone' },
  ]) {
    assert.throws(
      () =>
        validateRegressionExecution({ regression: request }, [
          { ...nodes[0], config },
        ]),
      /requires GitHub-backed TypeScript/,
    );
  }
});

test('focused requests cannot weaken release verification or generated-test validators', () => {
  for (const body of [
    { regression: request, release: {} },
    { regression: request, ci: {} },
  ]) {
    assert.throws(
      () => validateRegressionExecution(body, nodes),
      /cannot be combined/,
    );
  }
  for (const nodeType of ['agent-container', 'codex-cli', 'validator']) {
    assert.throws(
      () =>
        validateRegressionExecution({ regression: request }, [
          ...nodes,
          { id: 'unsafe', nodeType },
        ]),
      /full-suite/,
    );
  }
  assert.throws(
    () => validateRegressionExecution({ regression: request }, []),
    /at least one Playwright/,
  );
});

test('execution snapshots retain immutable source context and saved mapping, without credentials', () => {
  const snapshot = captureExecutionDefinition({
    regression: request,
    nodes,
    workflow: { definition: { name: 'Shared library checks' } },
  });
  assert.deepEqual(snapshot.regression, request);
  assert.deepEqual(snapshot.nodes[0].regressionPolicy, policy);
  assert.doesNotMatch(JSON.stringify(snapshot), /must-not-be-captured/);
  policy.journeys[0].title = 'Changed after capture';
  assert.equal(
    snapshot.nodes[0].regressionPolicy?.journeys[0].title,
    'Account settings',
  );
  policy.journeys[0].title = 'Account settings';
});
