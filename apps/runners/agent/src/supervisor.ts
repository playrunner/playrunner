import type { ValidationResult } from './validator';

export const SUPERVISOR_SCHEMA_VERSION = '1.0';

export type SupervisorStopReason =
  | 'passed'
  | 'max_attempts'
  | 'max_duration'
  | 'agent_failed'
  | 'validator_failed';

export type SupervisorAttempt = {
  agent: {
    completedAt: string;
    durationMs: number;
    error?: string;
    startedAt: string;
    status: 'completed' | 'failed';
  };
  attempt: number;
  validation?: ValidationResult;
};

export type SupervisorResult = {
  attemptHistory: SupervisorAttempt[];
  attempts: number;
  completedAt: string;
  durationMs: number;
  error?: string;
  schemaVersion: typeof SUPERVISOR_SCHEMA_VERSION;
  sessionId?: string;
  startedAt: string;
  status: 'passed' | 'failed';
  stopReason: SupervisorStopReason;
  validation: ValidationResult | null;
};

export type SupervisorProgressEvent = {
  attempt: number;
  maximumAttempts: number;
  message: string;
  stage: 'agent' | 'validation' | 'completed';
};

export type SupervisorOptions = {
  initialPrompt: string;
  maximumAttempts: number;
  maximumDurationMs: number;
  now?: () => number;
  onProgress?: (event: SupervisorProgressEvent) => void | Promise<void>;
  runAgent: (request: {
    attempt: number;
    prompt: string;
    resumeSessionId?: string;
    timeoutMs: number;
  }) => Promise<{ sessionId?: string }>;
  validate: (request: {
    attempt: number;
    timeoutMs: number;
  }) => Promise<ValidationResult>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function compactFeedback(validation: ValidationResult): string {
  return JSON.stringify({
    artifacts: validation.artifacts,
    coverageEvidence: validation.coverageEvidence,
    dimensions: validation.dimensions,
    failedTests: validation.testRun.failedTests,
    findings: validation.feedback.items,
    unitTestRun: validation.unitTestRun,
    requirements: validation.requirements.items
      .filter((item) => !item.passed)
      .map((item) => ({
        critical: item.critical,
        description: item.description,
        id: item.id,
      })),
  });
}

export function buildValidatorFeedbackPrompt(
  validation: ValidationResult,
): string {
  const structured = compactFeedback(validation);
  return [
    'The authoritative Playrunner validation suite rejected the previous attempt.',
    'Continue in this exact repository and fix every blocking finding. Do not weaken, disable, or bypass the validator policy. Run playrunner-validator before yielding.',
    validation.feedbackText,
    `Machine-readable validation evidence:\n${structured}`,
  ].join('\n\n');
}

export async function runSupervisor(
  options: SupervisorOptions,
): Promise<SupervisorResult> {
  const now = options.now || Date.now;
  const startedAtMs = now();
  const startedAt = new Date(startedAtMs).toISOString();
  const deadline = startedAtMs + Math.max(1, options.maximumDurationMs);
  const maximumAttempts = Math.max(
    1,
    Math.min(10, Math.floor(options.maximumAttempts) || 1),
  );
  const attemptHistory: SupervisorAttempt[] = [];
  let sessionId: string | undefined;
  let validation: ValidationResult | null = null;

  const finish = (
    status: SupervisorResult['status'],
    stopReason: SupervisorStopReason,
    error?: string,
  ): SupervisorResult => {
    const completedAtMs = now();
    return {
      attemptHistory,
      attempts: attemptHistory.length,
      completedAt: new Date(completedAtMs).toISOString(),
      durationMs: Math.max(0, completedAtMs - startedAtMs),
      ...(error ? { error } : {}),
      schemaVersion: SUPERVISOR_SCHEMA_VERSION,
      ...(sessionId ? { sessionId } : {}),
      startedAt,
      status,
      stopReason,
      validation,
    };
  };

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const remainingBeforeAgent = deadline - now();
    if (remainingBeforeAgent <= 0) {
      return finish(
        'failed',
        'max_duration',
        'The AI Container reached its maximum duration.',
      );
    }

    await options.onProgress?.({
      attempt,
      maximumAttempts,
      message: `Agent attempt ${attempt} of ${maximumAttempts}.`,
      stage: 'agent',
    });
    const agentStartedAtMs = now();
    const historyEntry: SupervisorAttempt = {
      agent: {
        completedAt: new Date(agentStartedAtMs).toISOString(),
        durationMs: 0,
        startedAt: new Date(agentStartedAtMs).toISOString(),
        status: 'completed',
      },
      attempt,
    };
    attemptHistory.push(historyEntry);

    try {
      const agentResult = await options.runAgent({
        attempt,
        prompt:
          attempt === 1
            ? options.initialPrompt
            : buildValidatorFeedbackPrompt(validation!),
        ...(sessionId ? { resumeSessionId: sessionId } : {}),
        timeoutMs: remainingBeforeAgent,
      });
      if (!sessionId) {
        sessionId = agentResult.sessionId?.trim();
        if (!sessionId) {
          throw new Error(
            'Codex did not report a thread ID; refusing an ambiguous resume.',
          );
        }
      } else if (
        agentResult.sessionId &&
        agentResult.sessionId.trim() !== sessionId
      ) {
        throw new Error('Codex resumed a different thread than requested.');
      }
      const agentCompletedAtMs = now();
      historyEntry.agent.completedAt = new Date(
        agentCompletedAtMs,
      ).toISOString();
      historyEntry.agent.durationMs = Math.max(
        0,
        agentCompletedAtMs - agentStartedAtMs,
      );
    } catch (error) {
      const agentCompletedAtMs = now();
      historyEntry.agent.completedAt = new Date(
        agentCompletedAtMs,
      ).toISOString();
      historyEntry.agent.durationMs = Math.max(
        0,
        agentCompletedAtMs - agentStartedAtMs,
      );
      historyEntry.agent.error = errorMessage(error);
      historyEntry.agent.status = 'failed';
      return finish('failed', 'agent_failed', historyEntry.agent.error);
    }

    const remainingBeforeValidation = deadline - now();
    if (remainingBeforeValidation <= 0) {
      return finish(
        'failed',
        'max_duration',
        'The AI Container reached its maximum duration before validation.',
      );
    }
    await options.onProgress?.({
      attempt,
      maximumAttempts,
      message: `Running authoritative validation for attempt ${attempt}.`,
      stage: 'validation',
    });
    try {
      validation = await options.validate({
        attempt,
        timeoutMs: remainingBeforeValidation,
      });
      historyEntry.validation = validation;
    } catch (error) {
      return finish('failed', 'validator_failed', errorMessage(error));
    }

    if (validation.passed) {
      await options.onProgress?.({
        attempt,
        maximumAttempts,
        message: `Validation passed on attempt ${attempt}.`,
        stage: 'completed',
      });
      return finish('passed', 'passed');
    }
  }

  await options.onProgress?.({
    attempt: maximumAttempts,
    maximumAttempts,
    message: `Validation still failed after ${maximumAttempts} attempts.`,
    stage: 'completed',
  });
  return finish(
    'failed',
    'max_attempts',
    `Validation still failed after ${maximumAttempts} attempts.`,
  );
}
