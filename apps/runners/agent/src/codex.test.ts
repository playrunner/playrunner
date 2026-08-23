import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  codexThreadIdFromEvent,
  createCodexArgs,
  createCodexEventParser,
  runCodex,
} from './codex';

test('reads current Codex thread.started JSONL events', () => {
  assert.equal(
    codexThreadIdFromEvent({
      thread_id: '019c-thread',
      type: 'thread.started',
    }),
    '019c-thread',
  );
  assert.equal(
    codexThreadIdFromEvent({
      thread: { id: 'nested-thread' },
      type: 'thread.started',
    }),
    'nested-thread',
  );
});

test('parses a thread ID when a JSONL event is split across chunks', () => {
  const parser = createCodexEventParser();
  parser.push('diagnostic output\n{"type":"thread.');
  parser.push('started","thread_id":"thread-123"}\n');
  parser.push('{"type":"item.completed","id":"not-a-thread"}\n');
  assert.equal(parser.finish(), 'thread-123');
});

test('captures the latest bounded Agent completion message', () => {
  const parser = createCodexEventParser();
  parser.push(
    `${JSON.stringify({
      item: {
        text: 'Updated the requirement evidence.',
        type: 'agent_message',
      },
      type: 'item.completed',
    })}\n`,
  );
  parser.finish();
  assert.equal(parser.summary(), 'Updated the requirement evidence.');
});

test('removes model credentials from Codex shell commands', () => {
  const args = createCodexArgs({
    config: { apiKeyEnvVar: 'MY_OPENAI_KEY', model: 'gpt-5.6-terra' },
    prompt: 'Improve the tests.',
    resumeSessionId: 'thread-123',
  });
  assert.equal(args[0], 'exec');
  assert.equal(
    args.includes('--dangerously-bypass-approvals-and-sandbox'),
    false,
  );
  assert.ok(args.includes('--sandbox'));
  assert.equal(args[args.indexOf('--sandbox') + 1], 'workspace-write');
  assert.ok(args.includes('approval_policy="never"'));
  assert.ok(args.includes('sandbox_workspace_write.network_access=false'));
  assert.ok(args.includes('--strict-config'));
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(args.includes('--ignore-rules'));
  assert.ok(args.includes('allow_login_shell=false'));
  assert.ok(
    args.includes(
      'shell_environment_policy.exclude=["CODEX_API_KEY","CODEX_ACCESS_TOKEN","OPENAI_API_KEY","PLAYRUNNER_AGENT_BOOTSTRAP","MY_OPENAI_KEY"]',
    ),
  );
  assert.equal(args.at(-2), 'thread-123');
  assert.equal(args.at(-1), '-');
  assert.equal(args.at(-3), 'resume');
  assert.ok(!args.includes('Improve the tests.'));
});

test('rejects a timed-out Codex process even when it handles TERM with exit 0', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-timeout-'));
  const executable = path.join(directory, 'codex');
  fs.writeFileSync(
    executable,
    '#!/usr/bin/env node\nprocess.on("SIGTERM", () => process.exit(0));\nsetInterval(() => {}, 1_000);\n',
    { mode: 0o755 },
  );
  try {
    await assert.rejects(
      runCodex({
        config: { apiKeyEnvVar: 'MODEL_KEY' },
        cwd: directory,
        environment: {
          MODEL_KEY: 'test-key',
          PATH: `${directory}${path.delimiter}${process.env.PATH || ''}`,
        },
        prompt: 'Test timeout handling.',
        timeoutMs: 100,
      }),
      /Codex exceeded the remaining AI Container duration/,
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('streams large prompts over stdin instead of placing them in argv', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-stdin-'));
  const executable = path.join(directory, 'codex');
  fs.writeFileSync(
    executable,
    [
      '#!/usr/bin/env node',
      "let prompt = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (chunk) => { prompt += chunk; });",
      "process.stdin.on('end', () => {",
      "  if (Buffer.byteLength(prompt, 'utf8') < 200000) process.exit(2);",
      "  console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-large-prompt' }));",
      '});',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  try {
    const result = await runCodex({
      config: { apiKeyEnvVar: 'MODEL_KEY' },
      cwd: directory,
      environment: {
        MODEL_KEY: 'test-key',
        PATH: `${directory}${path.delimiter}${process.env.PATH || ''}`,
      },
      prompt: 'x'.repeat(200_000),
      timeoutMs: 2_000,
    });
    assert.equal(result.sessionId, 'thread-large-prompt');
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('returns a generic failure when Codex diagnostics contain credentials', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-secret-'));
  const executable = path.join(directory, 'codex');
  fs.writeFileSync(
    executable,
    '#!/usr/bin/env node\nprocess.stderr.write(process.env.CODEX_API_KEY || "missing");\nprocess.exit(7);\n',
    { mode: 0o755 },
  );
  try {
    await assert.rejects(
      runCodex({
        config: { apiKeyEnvVar: 'MODEL_KEY' },
        cwd: directory,
        environment: {
          MODEL_KEY: 'model-secret-value',
          PATH: `${directory}${path.delimiter}${process.env.PATH || ''}`,
        },
        prompt: 'Test redaction.',
        prohibitedExactValues: ['github-secret-value'],
        timeoutMs: 2_000,
      }),
      (error: Error) => {
        assert.match(error.message, /blocked output/);
        assert.doesNotMatch(error.message, /model-secret-value/);
        return true;
      },
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('scans Codex diagnostics before tail truncation', async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'codex-secret-boundary-'),
  );
  const executable = path.join(directory, 'codex');
  const credential = 'boundary-secret-value';
  fs.writeFileSync(
    executable,
    `#!/usr/bin/env node\nprocess.stderr.write('x'.repeat(200) + process.env.CODEX_API_KEY + 'z'.repeat(3990));\nprocess.exit(7);\n`,
    { mode: 0o755 },
  );
  try {
    await assert.rejects(
      runCodex({
        config: { apiKeyEnvVar: 'MODEL_KEY' },
        cwd: directory,
        environment: {
          MODEL_KEY: credential,
          PATH: `${directory}${path.delimiter}${process.env.PATH || ''}`,
        },
        prompt: 'Test boundary redaction.',
        timeoutMs: 2_000,
      }),
      (error: Error) => {
        assert.match(error.message, /blocked output/);
        assert.doesNotMatch(error.message, /boundary-secret-value/);
        assert.doesNotMatch(error.message, /secret-value/);
        return true;
      },
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});
