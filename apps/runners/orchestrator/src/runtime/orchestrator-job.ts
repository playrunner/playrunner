import {
  ORCHESTRATOR_BOOTSTRAP_ENV,
  ORCHESTRATOR_BOOTSTRAP_HEADER,
  ORCHESTRATOR_BOOTSTRAP_MAX_BYTES,
  ORCHESTRATOR_PAYLOAD_MAX_BYTES,
} from '../../../shared/orchestrator-bootstrap';

type OrchestratorBootstrap = {
  apiUrl: string;
  executionId: string;
  token: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseOrchestratorBootstrap(
  value = process.env[ORCHESTRATOR_BOOTSTRAP_ENV],
): OrchestratorBootstrap | null {
  if (value === undefined) return null;
  if (
    !value ||
    Buffer.byteLength(value, 'utf8') > ORCHESTRATOR_BOOTSTRAP_MAX_BYTES
  ) {
    throw new Error('Orchestrator bootstrap is invalid.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Orchestrator bootstrap is invalid.');
  }
  if (!isRecord(parsed)) {
    throw new Error('Orchestrator bootstrap is invalid.');
  }
  const apiUrl = typeof parsed.apiUrl === 'string' ? parsed.apiUrl : '';
  const executionId =
    typeof parsed.executionId === 'string' ? parsed.executionId : '';
  const token = typeof parsed.token === 'string' ? parsed.token : '';
  let origin: string;
  try {
    const url = new URL(apiUrl);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error('origin');
    }
    origin = url.origin;
  } catch {
    throw new Error('Orchestrator bootstrap API URL is invalid.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(executionId)) {
    throw new Error('Orchestrator bootstrap execution ID is invalid.');
  }
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) {
    throw new Error('Orchestrator bootstrap token is invalid.');
  }
  return { apiUrl: origin, executionId, token };
}

export async function runOrchestratorJob({
  bootstrap,
  execute,
  fetchImpl = fetch,
}: {
  bootstrap: OrchestratorBootstrap;
  execute: (payload: Record<string, unknown>) => Promise<void>;
  fetchImpl?: typeof fetch;
}) {
  const response = await fetchImpl(
    `${bootstrap.apiUrl}/api/outputs/${bootstrap.executionId}/orchestrator-payload`,
    {
      method: 'POST',
      headers: { [ORCHESTRATOR_BOOTSTRAP_HEADER]: bootstrap.token },
      signal: AbortSignal.timeout(30_000),
    },
  );
  const declaredLength = Number(response.headers.get('content-length'));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > ORCHESTRATOR_PAYLOAD_MAX_BYTES
  ) {
    throw new Error('Orchestrator payload response exceeded the allowed size.');
  }
  const responseText = await response.text();
  if (
    Buffer.byteLength(responseText, 'utf8') > ORCHESTRATOR_PAYLOAD_MAX_BYTES
  ) {
    throw new Error('Orchestrator payload response exceeded the allowed size.');
  }
  if (!response.ok) {
    throw new Error(
      `Orchestrator payload request failed with status ${response.status}.`,
    );
  }
  let responseBody: unknown;
  try {
    responseBody = JSON.parse(responseText);
  } catch {
    throw new Error('Orchestrator payload response was invalid.');
  }
  const payload = isRecord(responseBody) ? responseBody.payload : undefined;
  if (!isRecord(payload) || payload.testId !== bootstrap.executionId) {
    throw new Error('Orchestrator payload response was invalid.');
  }
  await execute(payload);
}
