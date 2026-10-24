/** Public diagnostics are an allowlist: never return exception text or connection URLs. */
const diagnostics = {
  LOCAL_EVENT_SERVICE_UNAVAILABLE: {
    service: 'message_service',
    message:
      'Playrunner could not prepare its message service. The workflow has not started.',
    recovery:
      'Check that the message service is running and reachable from the API. After a server or Docker restart, check that services share the current network. Restore the service before starting a new run.',
  },
  LOCAL_RUNNER_UNAVAILABLE: {
    service: 'runner',
    message:
      'Playrunner could not start or reach its local runner. The workflow has not started.',
    recovery:
      'Check the runner and Docker service, then start a new run after they recover.',
  },
  LOCAL_RUNNER_REJECTED: {
    service: 'runner',
    message: 'The local runner rejected the workflow start request.',
    recovery:
      'Check the runner logs for this execution before starting another run.',
  },
} as const;

export type ServiceDiagnosticCode = keyof typeof diagnostics;

export function serviceDiagnostic(code: unknown) {
  if (typeof code !== 'string' || !Object.hasOwn(diagnostics, code))
    return null;
  return {
    code: code as ServiceDiagnosticCode,
    ...diagnostics[code as ServiceDiagnosticCode],
  };
}

const reasons = {
  connection_refused: 'The service refused the connection.',
  connection_lost: 'The connection to the service was interrupted.',
  dns_unavailable: 'The service address could not be resolved.',
  timeout: 'The service did not respond in time.',
  unhealthy_response: 'The service returned an unsuccessful response.',
  unavailable: 'The service is unavailable.',
} as const;

export function dependencyFailureReason(error: unknown): keyof typeof reasons {
  let current = error;
  for (
    let depth = 0;
    depth < 5 && current && typeof current === 'object';
    depth++
  ) {
    const value = current as {
      code?: unknown;
      name?: unknown;
      cause?: unknown;
    };
    if (value.code === 'ECONNREFUSED') return 'connection_refused';
    if (
      value.code === 'ECONNRESET' ||
      value.code === 'EPIPE' ||
      value.code === 'UND_ERR_SOCKET'
    )
      return 'connection_lost';
    if (value.code === 'ENOTFOUND' || value.code === 'EAI_AGAIN')
      return 'dns_unavailable';
    if (
      value.code === 'ETIMEDOUT' ||
      value.name === 'TimeoutError' ||
      value.name === 'AbortError'
    )
      return 'timeout';
    if (value.code === 'SERVICE_HTTP_ERROR') return 'unhealthy_response';
    current = value.cause;
  }
  return 'unavailable';
}

export function serviceFailureBody(
  code: ServiceDiagnosticCode,
  reason?: unknown,
) {
  const diagnostic = serviceDiagnostic(code)!;
  const safeReason =
    typeof reason === 'string' && Object.hasOwn(reasons, reason)
      ? (reason as keyof typeof reasons)
      : undefined;
  return {
    ...diagnostic,
    ...(safeReason ? { reason: safeReason } : {}),
    error: [
      diagnostic.message,
      safeReason ? reasons[safeReason] : '',
      diagnostic.recovery,
    ]
      .filter(Boolean)
      .join(' '),
  };
}
