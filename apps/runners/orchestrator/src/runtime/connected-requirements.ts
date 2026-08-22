import type { AgentExecutionRequest } from './contracts';

type Requirement = NonNullable<AgentExecutionRequest['requirements']>[number];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requirement(value: unknown): Requirement | null {
  const candidate = record(value);
  const source = candidate.source;
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
  const title =
    typeof candidate.title === 'string' ? candidate.title.trim() : '';
  const body = typeof candidate.body === 'string' ? candidate.body : '';
  const url = typeof candidate.url === 'string' ? candidate.url.trim() : '';
  if (
    (source !== 'github' && source !== 'jira') ||
    !id ||
    !title ||
    id.length > 256 ||
    title.length > 1_024 ||
    Buffer.byteLength(body, 'utf8') > 64 * 1024 ||
    url.length > 2_048
  ) {
    return null;
  }
  return { body, id, source, title, ...(url ? { url } : {}) };
}

export function requirementsFromConnectedOutputs(
  outputs: Readonly<Record<string, unknown>>,
): Requirement[] {
  const found: Requirement[] = [];
  for (const output of Object.values(outputs)) {
    const acceptanceCriteria = record(output).acceptanceCriteria;
    const candidates = Array.isArray(acceptanceCriteria)
      ? acceptanceCriteria
      : [acceptanceCriteria];
    for (const candidate of candidates) {
      const parsed = requirement(candidate);
      if (parsed) found.push(parsed);
    }
  }
  return found.slice(0, 20);
}

export function requirementsFromWorkflowInput(value: unknown): Requirement[] {
  const values = Array.isArray(value)
    ? value
    : value === undefined
      ? []
      : [value];
  return values
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item && item.length <= 4_096)
    .slice(0, 20)
    .map((item, index) => ({
      body: item,
      id: `CLI-${index + 1}`,
      source: 'workflow' as const,
      title: item.slice(0, 1_024),
    }));
}
