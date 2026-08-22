export const MAX_WORKFLOW_RUN_BODY_BYTES = 128 * 1024;

export class WorkflowRunInputValidationError extends Error {}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorkflowRunInputValidationError(
      'Workflow run body must be an object.',
    );
  }
  return value as Record<string, unknown>;
}

export function parseWorkflowRunInputs(value: unknown) {
  const body = record(value);
  const rawInputs = body.inputs === undefined ? {} : record(body.inputs);
  const entries = Object.entries(rawInputs);
  if (entries.length > 50) {
    throw new WorkflowRunInputValidationError(
      'Workflow inputs must contain at most 50 values.',
    );
  }
  const inputs: Record<string, string> = {};
  for (const [key, input] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)) {
      throw new WorkflowRunInputValidationError(
        `Workflow input name is invalid: ${key}`,
      );
    }
    if (
      typeof input !== 'string' ||
      input.length > 4_096 ||
      input.includes('\0')
    ) {
      throw new WorkflowRunInputValidationError(
        `Workflow input ${key} must be a string of at most 4096 characters.`,
      );
    }
    inputs[key] = input;
  }
  const rawCriteria = body.acceptanceCriteria;
  const criteria =
    rawCriteria === undefined
      ? []
      : Array.isArray(rawCriteria)
        ? rawCriteria
        : [rawCriteria];
  if (
    criteria.length > 20 ||
    criteria.some(
      (item) =>
        typeof item !== 'string' || item.length > 4_096 || item.includes('\0'),
    )
  ) {
    throw new WorkflowRunInputValidationError(
      'Acceptance criteria must contain at most 20 strings of 4096 characters.',
    );
  }
  return { inputs, acceptanceCriteria: criteria as string[] };
}
