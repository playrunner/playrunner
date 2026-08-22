import fs from 'node:fs';
import { loadAgentPayload } from './bootstrap';
import {
  stageAgentArtifacts,
  uploadAgentArtifacts,
  type AgentArtifactRefs,
} from './artifacts';
import {
  createAgentAttachmentEvents,
  publishAttachmentCancelled,
  publishAttachmentFailure,
  publishAttachmentOutcome,
  publishAttachmentPending,
  publishSupervisorProgress,
} from './attachment-events';
import { createCredentialFreeEnvironment } from './codex-auth';
import { runCodex } from './codex';
import { deliverBotPullRequest, type BotPrDeliveryResult } from './bot-pr';
import {
  createInitialPrompt,
  materializeAgentContext,
  mergeValidatorConfigs,
} from './payload';
import { runProcess } from './process';
import {
  containsProhibitedExactValue,
  credentialSafeErrorMessage,
  CREDENTIAL_LEAK_MESSAGE,
  normalizeProhibitedExactValues,
} from './secret-values';
import {
  getAgentIdentity,
  prepareRepository,
  type PreparedRepository,
} from './repository';
import {
  boundInlineAgentResult,
  createInlineAttemptHistory,
  truncateInlinePatch,
} from './result';
import { createRunnerControlClient } from '../../shared/runner-control';
import { runSupervisor, type SupervisorResult } from './supervisor';
import {
  createStructuredMemory,
  type TerminalFailureKind,
} from './structured-memory';
import { validatePlaywrightTests } from './validator';

const INLINE_PATCH_BYTES = 500_000;
const MAX_PATCH_CAPTURE_BYTES = 50 * 1_024 * 1_024;
const HARD_STOP_REPORT_TIMEOUT_MS = 35_000;

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

function runnerFailureResult(
  error: string,
  stopReason: string,
  supervisor?: SupervisorResult,
): Record<string, unknown> {
  return boundInlineAgentResult(
    {
      attemptHistory: supervisor ? createInlineAttemptHistory(supervisor) : [],
      attempts: supervisor?.attempts || 0,
      patch: '',
      patchBytes: 0,
      patchTruncated: false,
      repositoryStatus: '',
      runnerError: error,
      status: 'failed',
      stopReason,
      validation: supervisor?.validation || null,
    },
    supervisor?.validation || null,
  );
}

async function main() {
  const loaded = await loadAgentPayload();
  if (loaded.action === 'cancel') return;
  const payload = loaded.payload;
  if (payload.agent.nodeType !== 'codex-cli') {
    throw new Error(`Unsupported Agent attachment: ${payload.agent.nodeType}`);
  }
  const agentConfig = payload.agent.config || {};
  const apiKeyEnvironmentVariable = String(
    agentConfig.apiKeyEnvVar || '',
  ).trim();
  const prohibitedExactValues = normalizeProhibitedExactValues([
    apiKeyEnvironmentVariable
      ? payload.environment[apiKeyEnvironmentVariable]
      : undefined,
    payload.github?.accessToken,
    payload.gcpAccessToken,
    payload.runtime.executionAuthToken,
    payload.runnerControl.protocolToken,
  ]);
  const safeErrorMessage = (error: unknown) =>
    credentialSafeErrorMessage(error, prohibitedExactValues);
  const runnerControl = createRunnerControlClient({
    config: payload.runnerControl,
    executionId: payload.runtime.testId,
    gcpAccessToken: payload.gcpAccessToken,
    logPrefix: '[AI Container]',
    nodeId: payload.runtime.nodeId,
    runnerName: 'AI Container',
    workflowEventAttributes: {
      cloudProvider: payload.runtime.cloudProvider,
    },
    workflowEventFields: { cloudProvider: payload.runtime.cloudProvider },
  });
  const attachments = createAgentAttachmentEvents({
    agentNodeId: payload.agent.nodeId,
    containerNodeId: payload.runtime.nodeId,
    validatorNodeIds: payload.validators.map((validator) => validator.nodeId),
  });
  await publishAttachmentPending(runnerControl, attachments);
  const maximumAttempts = boundedInteger(
    payload.config.maxValidationAttempts,
    3,
    1,
    10,
  );
  const maximumDurationMinutes = boundedInteger(
    payload.config.maxDurationMinutes,
    60,
    1,
    1440,
  );
  const identity = getAgentIdentity();
  const baseAgentEnvironment = { ...process.env, HOME: identity.home };
  const repositoryEnvironment = createCredentialFreeEnvironment(
    agentConfig,
    baseAgentEnvironment,
  );

  let cwd: string;
  let agentContext: ReturnType<typeof materializeAgentContext>;
  let baselineRevision: string;
  let prepared: PreparedRepository;
  let validatorConfig: ReturnType<typeof mergeValidatorConfigs>;
  try {
    await runnerControl.log(
      'Preparing the repository and authoritative validator.',
    );
    prepared = await prepareRepository(payload, {
      environment: repositoryEnvironment,
      identity,
    });
    cwd = prepared.workingDirectory;
    agentContext = materializeAgentContext(
      payload,
      prepared.changeManifest,
      '/workspace/inputs',
      prepared.supportingRepositories,
      prepared.repositoryRoot,
    );
    validatorConfig = mergeValidatorConfigs(payload);
    baselineRevision = prepared.headRevision;
    await runnerControl.log('Prepared and waiting for a start signal.');
    await runnerControl.publishStatus('ready');
  } catch (error) {
    const message = safeErrorMessage(error);
    await runnerControl.log(`Preparation failed: ${message}`, 'error');
    await publishAttachmentFailure(runnerControl, attachments, message);
    await runnerControl.publishNodeState('error');
    await runnerControl.publishStatus('prepare_failed', message);
    throw new Error(message);
  }

  let action: 'cancel' | 'start';
  try {
    action = await runnerControl.waitForStartSignal();
  } catch (error) {
    const message = safeErrorMessage(error);
    await runnerControl.log(`Runner control failed: ${message}`, 'error');
    await publishAttachmentFailure(runnerControl, attachments, message);
    await runnerControl.publishNodeState('error');
    await runnerControl.publishStatus('failed', message);
    throw new Error(message);
  }
  if (action === 'cancel') {
    await runnerControl.log('Cancelled before the agent started.');
    await publishAttachmentCancelled(runnerControl, attachments);
    await runnerControl.publishNodeState('warning');
    await runnerControl.publishStatus('cancelled');
    return;
  }

  const hardDeadline = Date.now() + maximumDurationMinutes * 60_000;
  let supervisor: SupervisorResult | undefined;
  let attachmentOutcomePublished = false;
  let terminalPublish: Promise<void> | null = null;
  const publishTerminal = (
    error: string | undefined,
    output: Record<string, unknown>,
  ): Promise<void> => {
    terminalPublish ||= (async () => {
      await runnerControl.publishNodeState(error ? 'error' : 'success');
      await runnerControl.publishStatus('completed', error, output);
    })();
    return terminalPublish;
  };
  const hardStop = setTimeout(() => {
    const message = `Hard duration limit of ${maximumDurationMinutes} minutes exceeded.`;
    console.error(`[AI Container] ${message}`);
    const reported = (async () => {
      await publishAttachmentFailure(runnerControl, attachments, message);
      await publishTerminal(
        message,
        runnerFailureResult(message, 'max_duration', supervisor),
      );
    })().then(
      () => true,
      () => false,
    );
    const reportTimeout = new Promise<false>((resolve) => {
      setTimeout(() => resolve(false), HARD_STOP_REPORT_TIMEOUT_MS).unref();
    });
    void Promise.race([reported, reportTimeout]).then((published) => {
      process.exit(published ? 0 : 124);
    });
  }, maximumDurationMinutes * 60_000);
  hardStop.unref();

  await runnerControl.publishStatus('started');
  await runnerControl.publishNodeState('running');
  await runnerControl.log(
    `Start signal received. Running up to ${maximumAttempts} validation attempt${maximumAttempts === 1 ? '' : 's'}.`,
  );

  const validatorConfigPath = `/tmp/playrunner-validator-${process.pid}.json`;
  try {
    fs.writeFileSync(
      validatorConfigPath,
      `${JSON.stringify(validatorConfig, null, 2)}\n`,
      { mode: 0o444 },
    );
    process.env.PLAYRUNNER_VALIDATOR_CONFIG = validatorConfigPath;
    const codexEnvironment = {
      ...baseAgentEnvironment,
      ...payload.environment,
      PLAYRUNNER_VALIDATOR_CONFIG: validatorConfigPath,
    };
    const validationEnvironment = createCredentialFreeEnvironment(
      agentConfig,
      codexEnvironment,
    );
    supervisor = await runSupervisor({
      initialPrompt: createInitialPrompt(payload, agentContext),
      maximumAttempts,
      maximumDurationMs: Math.max(1, hardDeadline - Date.now()),
      onProgress: (event) =>
        publishSupervisorProgress(runnerControl, attachments, event),
      runAgent: ({ prompt, resumeSessionId, timeoutMs }) =>
        runCodex({
          config: agentConfig,
          cwd,
          environment: codexEnvironment,
          gid: identity.gid,
          prompt,
          prohibitedExactValues,
          ...(resumeSessionId ? { resumeSessionId } : {}),
          timeoutMs,
          uid: identity.uid,
        }),
      validate: ({ attempt, timeoutMs }) =>
        validatePlaywrightTests(cwd, validatorConfig, {
          attempt,
          authoritative: true,
          changeManifest: prepared.changeManifest,
          repositoryRoot: prepared.repositoryRoot,
          runCommand: (command, workingDirectory, commandTimeoutMs) =>
            runProcess('/bin/sh', ['-c', command], {
              cwd: workingDirectory,
              env: validationEnvironment,
              gid: identity.gid,
              maxOutputBytes: 1_000_000,
              timeoutMs: commandTimeoutMs,
              uid: identity.uid,
            }),
          timeoutMs,
        }),
    });
    if (
      containsProhibitedExactValue(
        JSON.stringify(supervisor),
        prohibitedExactValues,
      )
    ) {
      supervisor = undefined;
      throw new Error(CREDENTIAL_LEAK_MESSAGE);
    }
    await publishAttachmentOutcome(runnerControl, attachments, supervisor);
    attachmentOutcomePublished = true;

    let botDelivery: BotPrDeliveryResult | undefined;
    let deliveryError: string | undefined;
    if (prepared.changeContext && supervisor.status === 'passed') {
      try {
        const githubToken = payload.github?.accessToken?.trim();
        if (!githubToken) {
          throw new Error(
            'Connect a GitHub App installed on the source repository with Contents and Pull requests read/write access so Playrunner can create a bot branch and draft pull request.',
          );
        }
        await runnerControl.log(
          'Validation passed. Inspecting the generated patch for bot PR delivery.',
        );
        botDelivery = await deliverBotPullRequest({
          cwd,
          developerHeadRef: prepared.changeContext.headRef,
          developerHeadSha: prepared.changeContext.headSha,
          environment: repositoryEnvironment,
          executionId: payload.runtime.testId,
          githubToken,
          identity,
          nodeId: payload.runtime.nodeId,
          prohibitedExactValues,
          repository: prepared.changeContext.repository,
          workflowId: payload.runtime.workflowId,
        });
        if (botDelivery.status === 'no_changes') {
          await runnerControl.log(
            'Changed behavior is already covered; no generated-test PR was needed.',
          );
        } else {
          await runnerControl.log(
            `${botDelivery.status === 'created' ? 'Opened' : 'Reused'} generated-test PR #${botDelivery.pullRequest.number}: ${botDelivery.pullRequest.url}`,
          );
        }
      } catch (error) {
        deliveryError = safeErrorMessage(error);
        await runnerControl.log(
          `Bot PR delivery failed: ${deliveryError}`,
          'error',
        );
      }
    }

    const intentToAdd = await runProcess(
      'git',
      ['add', '--intent-to-add', '.'],
      {
        cwd,
        env: repositoryEnvironment,
        gid: identity.gid,
        timeoutMs: 60_000,
        uid: identity.uid,
      },
    );
    const repositoryErrors: string[] = [];
    if (intentToAdd.code !== 0 || intentToAdd.timedOut) {
      repositoryErrors.push(
        'Could not include untracked paths in the generated patch.',
      );
      await runnerControl.log(
        `Could not stage untracked paths for the patch: ${safeErrorMessage(intentToAdd.stderr.slice(-2_000))}`,
        'error',
      );
    }
    const diff = await runProcess(
      'git',
      ['diff', '--binary', '--no-ext-diff', baselineRevision],
      {
        cwd,
        env: repositoryEnvironment,
        gid: identity.gid,
        maxOutputBytes: MAX_PATCH_CAPTURE_BYTES,
        timeoutMs: 2 * 60_000,
        uid: identity.uid,
      },
    );
    if (diff.code !== 0 || diff.timedOut || diff.stdoutTruncated) {
      repositoryErrors.push(
        diff.stdoutTruncated
          ? 'The generated repository patch exceeded the 50 MiB capture limit.'
          : 'Could not generate a complete repository patch.',
      );
    }
    const status = await runProcess('git', ['status', '--short'], {
      cwd,
      env: repositoryEnvironment,
      gid: identity.gid,
      maxOutputBytes: 2_000_000,
      timeoutMs: 60_000,
      uid: identity.uid,
    });
    if (status.code !== 0 || status.timedOut || status.stdoutTruncated) {
      repositoryErrors.push(
        status.stdoutTruncated
          ? 'The repository status exceeded the 2 MB capture limit.'
          : 'Could not inspect the final repository status.',
      );
    }
    const repositoryError = repositoryErrors.join(' ');
    const completePatch =
      diff.code === 0 && !diff.timedOut && !diff.stdoutTruncated
        ? diff.stdout
        : '';

    let credentialLeakDetected =
      containsProhibitedExactValue(completePatch, prohibitedExactValues) ||
      containsProhibitedExactValue(status.stdout, prohibitedExactValues) ||
      deliveryError === CREDENTIAL_LEAK_MESSAGE;
    let artifacts: AgentArtifactRefs | undefined;
    let artifactError: string | undefined;
    if (credentialLeakDetected) {
      artifactError = CREDENTIAL_LEAK_MESSAGE;
      await runnerControl.log(CREDENTIAL_LEAK_MESSAGE, 'error');
    } else {
      try {
        const staged = stageAgentArtifacts({
          directory: '/workspace/playrunner-artifacts',
          patch: completePatch,
          prohibitedExactValues,
          repositoryStatus: status.stdout,
          supervisor,
          workspace: cwd,
        });
        artifacts = await uploadAgentArtifacts(staged, payload.runtime);
        await runnerControl.log('Uploaded validation and workspace artifacts.');
      } catch (error) {
        artifactError = safeErrorMessage(error);
        credentialLeakDetected = artifactError === CREDENTIAL_LEAK_MESSAGE;
        await runnerControl.log(artifactError, 'error');
      }
    }

    if (credentialLeakDetected) {
      const failure = CREDENTIAL_LEAK_MESSAGE;
      await publishTerminal(
        failure,
        runnerFailureResult(failure, 'credential_leak'),
      );
      return;
    }

    const patchBytes = Buffer.byteLength(completePatch, 'utf8');
    const inlinePatch = truncateInlinePatch(completePatch, INLINE_PATCH_BYTES);
    const effectiveStatus =
      artifactError || repositoryError || deliveryError
        ? 'failed'
        : supervisor.status;
    const terminalFailureKind: TerminalFailureKind | undefined = artifactError
      ? 'artifact'
      : repositoryError
        ? 'repository'
        : deliveryError
          ? 'delivery'
          : undefined;
    const memory = createStructuredMemory({
      delivery: botDelivery,
      effectiveStatus,
      prepared,
      repository: String(payload.config.repository),
      supervisor,
      ...(terminalFailureKind ? { terminalFailureKind } : {}),
    });
    const result = boundInlineAgentResult(
      {
        ...(artifactError ? { artifactError } : {}),
        ...(artifacts ? { artifacts } : {}),
        attemptHistory: createInlineAttemptHistory(supervisor),
        attempts: supervisor.attempts,
        ...(botDelivery ? { botDelivery } : {}),
        ...(botDelivery && botDelivery.status !== 'no_changes'
          ? {
              botPullRequest: {
                ...botDelivery.pullRequest,
                branchName: botDelivery.branchName,
                commitSha: botDelivery.commitSha,
                status: botDelivery.status,
              },
            }
          : {}),
        ...(deliveryError ? { deliveryError } : {}),
        ...(memory ? { memory } : {}),
        patch: inlinePatch,
        patchBytes,
        patchTruncated:
          Boolean(repositoryError) || patchBytes > INLINE_PATCH_BYTES,
        ...(repositoryError ? { repositoryError } : {}),
        repositories: [
          {
            editable: true,
            headRevision: prepared.headRevision,
            repository: String(payload.config.repository),
            role: 'primary',
          },
          ...(prepared.supportingRepositories || []).map((repository) => ({
            editable: false,
            headRevision: repository.headRevision,
            repository: repository.repository,
            role: 'supporting',
          })),
        ],
        repositoryStatus: status.stdout,
        requirementSources: (payload.requirements || []).map(
          ({ id, source, title, url }) => ({ id, source, title, url }),
        ),
        status: effectiveStatus,
        stopReason: artifactError
          ? 'artifact_failed'
          : repositoryError
            ? 'repository_inspection_failed'
            : deliveryError
              ? 'delivery_failed'
              : supervisor.stopReason,
        validation: supervisor.validation,
      },
      supervisor.validation,
    );
    if (
      containsProhibitedExactValue(
        JSON.stringify(result),
        prohibitedExactValues,
      )
    ) {
      const failure = CREDENTIAL_LEAK_MESSAGE;
      await publishTerminal(
        failure,
        runnerFailureResult(failure, 'credential_leak'),
      );
      return;
    }
    const failure =
      effectiveStatus === 'passed'
        ? undefined
        : artifactError ||
          repositoryError ||
          deliveryError ||
          supervisor.error ||
          supervisor.validation?.feedback.summary ||
          'AI Container validation failed.';
    if (failure) await runnerControl.log(failure, 'error');
    else await runnerControl.log('AI Container validation passed.');
    await publishTerminal(failure, result);
  } catch (error) {
    const message = safeErrorMessage(error);
    await runnerControl.log(`Runner failed: ${message}`, 'error');
    if (!attachmentOutcomePublished) {
      await publishAttachmentFailure(runnerControl, attachments, message);
    }
    await publishTerminal(
      message,
      runnerFailureResult(message, 'runner_failed', supervisor),
    );
  } finally {
    clearTimeout(hardStop);
    fs.rmSync(validatorConfigPath, { force: true });
    delete process.env.PLAYRUNNER_VALIDATOR_CONFIG;
  }
}

void main().catch(() => {
  console.error('[AI Container] Runner failed before terminal reporting.');
  process.exitCode = 1;
});
