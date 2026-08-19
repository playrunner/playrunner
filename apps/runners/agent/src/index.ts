import fs from 'fs';
import path from 'path';
import { createCodexEnvironment } from './codex-auth';
import { runProcess } from './process';
import { validatePlaywrightTests, type ValidationResult } from './validator';

type Payload = {
  agent: { config?: Record<string, unknown>; nodeType: string };
  config: Record<string, any>;
  github?: { accessToken?: string };
  validators: Array<{ config?: Record<string, unknown>; nodeType: string }>;
};

const RESULT_PREFIX = 'PLAYRUNNER_AGENT_RESULT:';

function encodeResult(value: unknown) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

async function cloneRepository(payload: Payload) {
  const repository = String(payload.config.repository || '').trim();
  if (!repository)
    throw new Error('AI Container requires a GitHub repository.');
  const branch = String(payload.config.branch || 'main');
  const token = payload.github?.accessToken;
  const url = token
    ? `https://x-access-token:${token}@github.com/${repository}.git`
    : `https://github.com/${repository}.git`;
  fs.rmSync('/workspace/repo', { recursive: true, force: true });
  fs.mkdirSync('/workspace', { recursive: true });
  console.log(`[AI Container] Cloning ${repository} (${branch}).`);
  const clone = await runProcess(
    'git',
    [
      'clone',
      '--depth',
      '1',
      '--branch',
      branch,
      '--single-branch',
      url,
      '/workspace/repo',
    ],
    { stream: true },
  );
  if (clone.code !== 0)
    throw new Error(`Git clone failed with code ${clone.code}.`);
  const folder = String(payload.config.folder || '.');
  const repositoryRoot = '/workspace/repo';
  const workingDirectory = path.resolve(repositoryRoot, folder);
  if (
    (workingDirectory !== repositoryRoot &&
      !workingDirectory.startsWith(`${repositoryRoot}${path.sep}`)) ||
    !fs.existsSync(workingDirectory)
  ) {
    throw new Error(
      `Working folder does not exist in the repository: ${folder}`,
    );
  }
  return workingDirectory;
}

function createPrompt(payload: Payload) {
  const agentConfig = payload.agent.config || {};
  return [
    'You are running inside a Playrunner AI Container with Playwright and browsers installed.',
    'Work autonomously in the checked-out repository. Inspect the application, install its dependencies when needed, write or improve valuable Playwright end-to-end tests, run them, and iterate until they pass.',
    'The command `playrunner-validator` is available as a tool. Run it before reporting completion and address its precise feedback.',
    'Do not merely make tests green: cover meaningful positive and negative behavior and use observable assertions.',
    `Task:\n${String(payload.config.task || 'Write valuable Playwright end-to-end tests.')}`,
    agentConfig.instructions
      ? `Additional instructions:\n${String(agentConfig.instructions)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function mergeValidatorConfigs(payload: Payload) {
  const configs = payload.validators.map((validator) => {
    if (validator.nodeType !== 'validator') {
      throw new Error(
        `Unsupported Validator attachment: ${validator.nodeType}`,
      );
    }
    return validator.config || {};
  });
  const minimumKeys = [
    'lineCoverage',
    'branchCoverage',
    'requirementCoverage',
    'assertionQuality',
  ];
  return {
    failOn: Array.from(
      new Set(configs.flatMap((config: any) => config.failOn || [])),
    ),
    minimum: Object.fromEntries(
      minimumKeys.map((key) => [
        key,
        Math.max(
          0,
          ...configs.map((config: any) => Number(config.minimum?.[key]) || 0),
        ),
      ]),
    ),
    requirements: configs
      .map((config: any) => String(config.requirements || '').trim())
      .filter(Boolean)
      .join('\n'),
  };
}

async function runCodex(
  cwd: string,
  payload: Payload,
  prompt: string,
  resume: boolean,
) {
  if (payload.agent.nodeType !== 'codex-cli') {
    throw new Error(`Unsupported agent attachment: ${payload.agent.nodeType}`);
  }
  const config = payload.agent.config || {};
  // The container itself is the security boundary. Full in-container access is
  // required for package installation, browsers, and target-environment traffic.
  const args = ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox'];
  if (config.model) args.push('--model', String(config.model));
  if (config.reasoningEffort) {
    args.push(
      '-c',
      `model_reasoning_effort=${JSON.stringify(String(config.reasoningEffort))}`,
    );
  }
  if (resume) args.push('resume', '--last');
  args.push(prompt);
  const result = await runProcess('codex', args, {
    cwd,
    env: createCodexEnvironment(config),
    stream: true,
  });
  if (result.code !== 0)
    throw new Error(`Codex CLI exited with code ${result.code}.`);
}

async function main() {
  const rawPayload = process.env.PAYLOAD;
  if (!rawPayload) throw new Error('PAYLOAD is required.');
  const payload = JSON.parse(rawPayload) as Payload;
  if (!payload.agent) throw new Error('Connect one Agent to the AI Container.');
  if (!payload.validators?.length)
    throw new Error('Connect at least one Validator to the AI Container.');
  const cwd = await cloneRepository(payload);
  const validatorConfig = mergeValidatorConfigs(payload);
  const validatorConfigPath = '/tmp/playrunner-validator-config.json';
  fs.writeFileSync(validatorConfigPath, JSON.stringify(validatorConfig));
  process.env.PLAYRUNNER_VALIDATOR_CONFIG = validatorConfigPath;
  const maximumAttempts = Math.max(
    1,
    Math.min(10, Number(payload.config.maxValidationAttempts) || 3),
  );
  let validation: ValidationResult | null = null;
  let attempts = 0;
  while (attempts < maximumAttempts) {
    attempts += 1;
    console.log(
      `[AI Container] Agent attempt ${attempts} of ${maximumAttempts}.`,
    );
    await runCodex(
      cwd,
      payload,
      attempts === 1
        ? createPrompt(payload)
        : `The authoritative Playrunner Validator rejected the previous attempt. Continue in the same repository and fix every blocking issue, then run playrunner-validator again.\n\n${validation?.feedback}`,
      attempts > 1,
    );
    console.log('[AI Container] Running authoritative validation.');
    validation = await validatePlaywrightTests(cwd, validatorConfig);
    console.log(validation.feedback);
    if (validation.passed) break;
  }
  await runProcess('git', ['add', '--intent-to-add', '.'], { cwd });
  const diff = await runProcess('git', ['diff', '--binary', '--no-ext-diff'], {
    cwd,
  });
  const status = await runProcess('git', ['status', '--short'], { cwd });
  const result = {
    attempts,
    patch: diff.stdout.slice(0, 2_000_000),
    repositoryStatus: status.stdout,
    status: validation?.passed ? 'passed' : 'failed',
    validation,
  };
  console.log(`${RESULT_PREFIX}${encodeResult(result)}`);
  if (!validation?.passed) process.exitCode = 2;
}

main().catch((error) => {
  console.error(
    `[AI Container] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
