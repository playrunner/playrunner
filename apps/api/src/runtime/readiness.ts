import { dependencyFailureReason } from './service-diagnostics';
import type { RequestHandler } from 'express';

type Check = {
  service: string;
  check: () => Promise<unknown>;
  recovery: string;
};
const timeoutMs = 2000;

async function checkService({ service, check, recovery }: Check) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(check),
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              Object.assign(new Error('timeout'), { name: 'TimeoutError' }),
            ),
          timeoutMs,
        );
      }),
    ]);
    return { service, status: 'ready' as const };
  } catch (error) {
    return {
      service,
      status: 'unavailable' as const,
      reason: dependencyFailureReason(error),
      recovery,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkHttp(url: string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error',
  });
  await response.body?.cancel();
  if (!response.ok)
    throw Object.assign(new Error('Dependency unavailable'), {
      code: 'SERVICE_HTTP_ERROR',
    });
}

/** Bounded, cached checks; no writes, runner startup, credentials or raw errors. */
export function createReadinessProbe({
  database,
  emulatorHost,
  projectId,
  mcpHealthUrl,
}: {
  database: () => Promise<unknown>;
  emulatorHost?: string;
  projectId: string;
  mcpHealthUrl?: string;
}) {
  const checks: Check[] = [
    {
      service: 'database',
      check: database,
      recovery: 'Check the database service and API database connection.',
    },
  ];
  if (emulatorHost)
    checks.push({
      service: 'message_service',
      check: () =>
        checkHttp(
          `http://${emulatorHost.replace(/^https?:\/\//, '')}/v1/projects/${encodeURIComponent(projectId)}/topics?pageSize=1`,
        ),
      recovery:
        'Check that the message service is reachable from the API. After a Docker restart, verify the services share the current network.',
    });
  if (mcpHealthUrl)
    checks.push({
      service: 'tool_service',
      check: () => checkHttp(mcpHealthUrl),
      recovery:
        'Check that the MCP tool service is reachable from the API and proxy.',
    });
  // A timed-out database probe may still be pending in the driver. Reuse it
  // rather than filling the connection pool on repeated health requests.
  const pending = new Map<string, Promise<unknown>>();
  const boundedChecks = checks.map((check) => ({
    ...check,
    check: () => {
      let work = pending.get(check.service);
      if (!work) {
        work = Promise.resolve()
          .then(check.check)
          .finally(() => pending.delete(check.service));
        pending.set(check.service, work);
      }
      return work;
    },
  }));
  let cached:
    | Promise<{
        status: 'ready' | 'unavailable';
        checks: Awaited<ReturnType<typeof checkService>>[];
      }>
    | undefined;
  let expiresAt = 0;
  return () => {
    if (!cached || Date.now() >= expiresAt) {
      expiresAt = Date.now() + 5000;
      cached = Promise.all(boundedChecks.map(checkService)).then((results) => ({
        status: results.every((result) => result.status === 'ready')
          ? 'ready'
          : 'unavailable',
        checks: results,
      }));
    }
    return cached;
  };
}

export function readinessHandler(
  probe: ReturnType<typeof createReadinessProbe>,
  legacy = false,
): RequestHandler {
  return async (_req, res) => {
    const result = await probe();
    res.setHeader('Cache-Control', 'no-store');
    if (legacy && result.status === 'ready') res.status(200).send('OK');
    else res.status(result.status === 'ready' ? 200 : 503).json(result);
  };
}
