import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  AGENT_MEMORY_SCHEMA_VERSION,
  createInitialPrompt,
  MAX_AGENT_MEMORY_BYTES,
  MAX_AGENT_PAYLOAD_BYTES,
  materializeAgentContext,
  mergeValidatorConfigs,
  readAgentPayload,
  type AgentRunnerPayload,
} from './payload';
import type { ChangeManifest } from './repository';

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);

function payload(): AgentRunnerPayload {
  return {
    agent: { config: {}, nodeId: 'codex-agent', nodeType: 'codex-cli' },
    config: {},
    environment: {},
    gcpAccessToken: 'gcp-token',
    runnerControl: {
      controlSubscriptionName: 'agent-control',
      projectId: 'test-project',
      protocolToken: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      topicName: 'workflow-events',
      type: 'gcp_pubsub',
    },
    runtime: {
      cloudProvider: 'LOCAL_RUNNER',
      editorApiUrl: 'http://editor.test',
      executionAuthToken: 'execution-token',
      nodeId: 'agent-node',
      testId: 'execution-1',
      workflowId: 'workflow-1',
    },
    validators: [
      { config: {}, nodeId: 'test-validator', nodeType: 'validator' },
    ],
  };
}

function addChangeContext(value: AgentRunnerPayload): void {
  value.changeContext = {
    baseRef: 'main',
    baseSha: BASE_SHA,
    eventType: 'pull_request',
    headRef: 'feature/checkout-tests',
    headSha: HEAD_SHA,
    pullRequestNumber: 42,
    repository: 'playrunner/example',
  };
  value.config.repository = 'playrunner/example';
}

function addMemory(value: AgentRunnerPayload): void {
  value.memory = {
    botPullRequest: {
      headRef: 'playrunner/tests/previous',
      headSha: 'c'.repeat(40),
      number: 41,
      url: 'https://github.com/playrunner/example/pull/41',
    },
    coverageGaps: [
      {
        changedLines: [{ end: 24, start: 20 }],
        path: 'src/checkout.ts',
        reason: 'The declined-payment branch was not covered.',
      },
    ],
    generatedTestFiles: ['tests/checkout.spec.ts'],
    lastProcessedHeadSha: 'c'.repeat(40),
    repository: 'playrunner/example',
    schemaVersion: AGENT_MEMORY_SCHEMA_VERSION,
    validation: { status: 'failed', summary: 'Changed-line coverage was 60%.' },
  };
}

function changeManifest(value: AgentRunnerPayload): ChangeManifest {
  return {
    context: value.changeContext!,
    files: [
      {
        binary: false,
        changedLineCount: 5,
        changedLines: [{ end: 24, start: 20 }],
        classification: 'production',
        path: 'src/checkout.ts',
        status: 'modified',
      },
    ],
    schemaVersion: '1.0',
    summary: {
      changedFiles: 1,
      changedLines: 5,
      configChangedLines: 0,
      configFiles: 0,
      productionChangedLines: 5,
      productionFiles: 1,
      testChangedLines: 0,
      testFiles: 0,
    },
  };
}

test('reads a bounded runner payload from stdin', async () => {
  const value = payload();
  const result = await readAgentPayload(Readable.from([JSON.stringify(value)]));
  assert.equal(result.agent.nodeType, 'codex-cli');
  assert.deepEqual(result.nodeOutputs, {});
});

test('materializes external requirements and adds them to the prompt and validator', async () => {
  const value = payload();
  value.config = {
    branch: 'main',
    folder: '.',
    repository: 'playrunner/example',
    task: 'Test checkout behavior.',
  };
  value.requirements = [
    {
      body: 'Declined cards show an actionable error.',
      id: 'PAY-42',
      source: 'jira',
      title: 'Handle declined cards',
      url: 'https://playrunner.atlassian.net/browse/PAY-42',
    },
  ];
  const normalized = await readAgentPayload(
    Readable.from([JSON.stringify(value)]),
  );
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'agent-requirements-'),
  );
  try {
    const context = materializeAgentContext(normalized, undefined, directory);
    assert.ok(context.requirementsPath);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(context.requirementsPath, 'utf8')),
      value.requirements,
    );
    assert.match(
      createInitialPrompt(normalized, context),
      /requirements\.json/,
    );
    assert.match(
      createInitialPrompt(normalized, context),
      /external requirements/i,
    );
    assert.match(
      String(mergeValidatorConfigs(normalized).requirements),
      /PAY-42: Handle declined cards/,
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('rejects reserved Environment keys in the trusted payload', async () => {
  const value = payload();
  value.environment = { DOCKER_HOST: 'tcp://attacker.test' };
  await assert.rejects(
    () => readAgentPayload(Readable.from([JSON.stringify(value)])),
    /reserved.*DOCKER_HOST/i,
  );
});

test('rejects an Environment payload that exceeds the aggregate exec limit', async () => {
  const value = payload();
  value.environment = Object.fromEntries(
    Array.from({ length: 9 }, (_, index) => [
      `VALUE_${index}`,
      'x'.repeat(64 * 1024),
    ]),
  );
  await assert.rejects(
    () => readAgentPayload(Readable.from([JSON.stringify(value)])),
    /Environment exceeds .* bytes in total.*artifacts/i,
  );
});

test('rejects NUL characters that child processes cannot receive', async () => {
  const value = payload();
  value.environment = { INVALID_VALUE: 'before\0after' };
  await assert.rejects(
    () => readAgentPayload(Readable.from([JSON.stringify(value)])),
    /variable INVALID_VALUE contains a NUL character/,
  );
});

test('requires artifact callback context before doing repository work', async () => {
  const value: Record<string, unknown> = { ...payload() };
  delete value.runtime;
  await assert.rejects(
    () => readAgentPayload(Readable.from([JSON.stringify(value)])),
    /runtime\.cloudProvider is required/,
  );
});

test('rejects unsafe runtime identifiers before artifact upload', async () => {
  const value = payload();
  value.runtime.nodeId = '../another-node';
  await assert.rejects(
    () => readAgentPayload(Readable.from([JSON.stringify(value)])),
    /runtime\.nodeId must be a safe identifier/,
  );

  const unsafeWorkflow = payload();
  unsafeWorkflow.runtime.workflowId = '../another-workflow';
  await assert.rejects(
    () => readAgentPayload(Readable.from([JSON.stringify(unsafeWorkflow)])),
    /runtime\.workflowId must be a safe identifier/,
  );
});

test('rejects an unsafe artifact callback origin', async () => {
  const value = payload();
  value.runtime.editorApiUrl = 'https://user:secret@attacker.test/path';
  await assert.rejects(
    () => readAgentPayload(Readable.from([JSON.stringify(value)])),
    /credential-free HTTP\(S\) origin/,
  );
});

test('requires a complete Pub/Sub runner control contract', async () => {
  const value = payload();
  value.runnerControl.controlSubscriptionName = '../another-subscription';
  await assert.rejects(
    () => readAgentPayload(Readable.from([JSON.stringify(value)])),
    /runnerControl\.controlSubscriptionName is invalid/,
  );
});

test('rejects an invalid runner protocol token', async () => {
  const value = payload();
  value.runnerControl.protocolToken = 'guessable-token';
  await assert.rejects(
    () => readAgentPayload(Readable.from([JSON.stringify(value)])),
    /runnerControl\.protocolToken is invalid/,
  );
});

test('requires stable, distinct attachment node IDs', async () => {
  const value = payload();
  value.validators[0].nodeId = value.agent.nodeId;
  await assert.rejects(
    () => readAgentPayload(Readable.from([JSON.stringify(value)])),
    /attachment node IDs must be unique/,
  );
});

test('rejects oversized runner input before parsing it', async () => {
  await assert.rejects(
    () =>
      readAgentPayload(
        Readable.from(['x'.repeat(MAX_AGENT_PAYLOAD_BYTES + 1)]),
      ),
    /exceeds/,
  );
});

test('merges validator policies using strict thresholds and stable defaults', () => {
  const value = payload();
  value.validators.push({
    config: {
      failOn: [],
      minimum: { branchCoverage: 90, lineCoverage: 85 },
      requirements: 'REQ-1: Checkout works',
      validationCommand: 'playwright test --retries=0',
    },
    nodeId: 'strict-validator',
    nodeType: 'validator',
  });
  const result = mergeValidatorConfigs(value);
  assert.equal(result.minimum?.branchCoverage, 90);
  assert.equal(result.minimum?.changedLineCoverage, 80);
  assert.equal(result.minimum?.lineCoverage, 85);
  assert.equal(result.minimum?.assertionQuality, 100);
  assert.ok(result.failOn?.includes('hardcoded_wait'));
  assert.equal(result.validationCommand, 'playwright test --retries=0');
});

test('rejects conflicting authoritative validation commands', () => {
  const value = payload();
  value.validators = [
    {
      config: { validationCommand: 'playwright test tests/a --retries=0' },
      nodeId: 'validator-a',
      nodeType: 'validator',
    },
    {
      config: { validationCommand: 'playwright test tests/b --retries=0' },
      nodeId: 'validator-b',
      nodeType: 'validator',
    },
  ];
  assert.throws(() => mergeValidatorConfigs(value), /different validation/);
});

test('normalizes immutable CI change context and bounded structured memory', async () => {
  const value = payload();
  addChangeContext(value);
  addMemory(value);
  const result = await readAgentPayload(Readable.from([JSON.stringify(value)]));
  assert.deepEqual(result.changeContext, value.changeContext);
  assert.deepEqual(result.memory, value.memory);
});

test('requires exact 40 or 64 character commit SHAs and safe branch names', async () => {
  const invalidSha = payload();
  addChangeContext(invalidSha);
  invalidSha.changeContext!.headSha = 'b'.repeat(41);
  await assert.rejects(
    () => readAgentPayload(Readable.from([JSON.stringify(invalidSha)])),
    /headSha must be a complete commit SHA/,
  );

  const invalidRef = payload();
  addChangeContext(invalidRef);
  invalidRef.changeContext!.headRef = 'refs/heads/feature';
  await assert.rejects(
    () => readAgentPayload(Readable.from([JSON.stringify(invalidRef)])),
    /headRef must be a safe branch name/,
  );

  const identical = payload();
  addChangeContext(identical);
  identical.changeContext!.headSha = BASE_SHA;
  await assert.rejects(
    () => readAgentPayload(Readable.from([JSON.stringify(identical)])),
    /baseSha and headSha must identify different commits/,
  );

  const sha256 = payload();
  addChangeContext(sha256);
  sha256.changeContext!.baseSha = 'a'.repeat(64);
  sha256.changeContext!.headSha = 'b'.repeat(64);
  const normalized = await readAgentPayload(
    Readable.from([JSON.stringify(sha256)]),
  );
  assert.equal(normalized.changeContext?.headSha.length, 64);
});

test('rejects raw transcript fields and cross-repository memory', async () => {
  const transcript = payload();
  addChangeContext(transcript);
  addMemory(transcript);
  (transcript.memory as unknown as Record<string, unknown>).transcript = [
    { content: 'raw model conversation', role: 'assistant' },
  ];
  await assert.rejects(
    () => readAgentPayload(Readable.from([JSON.stringify(transcript)])),
    /memory\.transcript is not supported/,
  );

  const mismatch = payload();
  addChangeContext(mismatch);
  addMemory(mismatch);
  mismatch.memory!.repository = 'another/repository';
  delete mismatch.memory!.botPullRequest;
  await assert.rejects(
    () => readAgentPayload(Readable.from([JSON.stringify(mismatch)])),
    /memory repository does not match changeContext/,
  );
});

test('rejects oversized structured memory independently of the payload limit', async () => {
  const value = payload();
  addChangeContext(value);
  addMemory(value);
  value.memory!.validation.summary = 'x'.repeat(MAX_AGENT_MEMORY_BYTES + 1);
  await assert.rejects(
    () => readAgentPayload(Readable.from([JSON.stringify(value)])),
    /memory exceeds .*not transcripts/,
  );
});

test('materializes read-only CI inputs and structured memory separately', () => {
  const value = payload();
  addChangeContext(value);
  addMemory(value);
  value.nodeOutputs = { node_environment: { deployedUrl: 'https://test/' } };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-context-'));
  try {
    const result = materializeAgentContext(value, changeManifest(value), root);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(result.nodeOutputsPath, 'utf8')),
      {
        node_environment: { deployedUrl: 'https://test/' },
      },
    );
    assert.equal(
      JSON.parse(fs.readFileSync(result.changeManifestPath!, 'utf8')).context
        .headSha,
      HEAD_SHA,
    );
    assert.equal(
      JSON.parse(fs.readFileSync(result.memoryPath!, 'utf8')).schemaVersion,
      AGENT_MEMORY_SCHEMA_VERSION,
    );
    for (const file of [
      result.nodeOutputsPath,
      result.changeManifestPath!,
      result.memoryPath!,
    ]) {
      assert.equal(fs.statSync(file).mode & 0o777, 0o444);
    }
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('refuses to materialize a manifest for a different immutable change', () => {
  const value = payload();
  addChangeContext(value);
  const manifest = changeManifest(value);
  manifest.context = { ...manifest.context, headSha: 'd'.repeat(40) };
  assert.throws(
    () => materializeAgentContext(value, manifest, '/tmp/unused-agent-context'),
    /manifest does not match the trusted change context/,
  );
});

test('prompts the agent to test changed behavior, use structured memory, and leave PR publication to Playrunner', () => {
  const value = payload();
  addChangeContext(value);
  addMemory(value);
  const prompt = createInitialPrompt(value, {
    changeManifestPath: '/workspace/inputs/change-manifest.json',
    memoryPath: '/workspace/inputs/previous-memory.json',
    nodeOutputsPath: '/workspace/inputs/workflow-inputs.json',
  });
  assert.match(prompt, /changed production files.*changed-line ranges/);
  assert.match(prompt, /direct existing test evidence or add focused tests/);
  assert.match(
    prompt,
    /bounded outcome summary, not a conversation transcript/,
  );
  assert.match(prompt, /Do not push, commit, or open a pull request/);
  assert.match(
    prompt,
    /install dependencies already declared.*do not edit package manifests or lockfiles/,
  );
  assert.match(prompt, /container-owned Playwright CLI/);
  assert.match(
    prompt,
    /does not require or invoke a package\.json test script/,
  );
  assert.match(
    prompt,
    /Never create or edit those reports from test\/config code/,
  );
  assert.match(prompt, /repository coverage as untrusted evidence/);
  assert.match(prompt, /pull request remains a draft/);
  assert.doesNotMatch(
    prompt,
    /Ensure the repository has a `test:coverage` script/,
  );
  assert.match(prompt, /Generate tests for changed production behavior/);
  assert.throws(
    () => createInitialPrompt(value, '/workspace/inputs/workflow-inputs.json'),
    /requires the authoritative change manifest path/,
  );
});
