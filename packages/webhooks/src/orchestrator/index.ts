import type {
  NodeExecutionContext,
  OrchestratorIntegrationContribution,
} from '@playrunner/integration-sdk/orchestrator';

const PRIVATE_IPV4 =
  /^(?:127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;
const MAX_RESPONSE_BYTES = 64 * 1024;

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function assertSafeUrl(value: string) {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    hostname === 'localhost' ||
    hostname === '::1' ||
    PRIVATE_IPV4.test(hostname)
  ) {
    throw new Error('Webhook target must be a public HTTPS URL.');
  }
  return url;
}

function parseHeaders(value: unknown): Record<string, string> {
  if (!value) return {};
  const parsed =
    typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Webhook headers must be a JSON object.');
  }
  const headers: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(parsed)) {
    if (
      ['authorization', 'cookie', 'host'].includes(name.toLowerCase()) ||
      typeof headerValue !== 'string'
    ) {
      continue;
    }
    headers[name] = headerValue;
  }
  return headers;
}

async function executeWebhook(context: NodeExecutionContext) {
  const config = context.node.config;
  if (config.mode === 'inbound') {
    return { outcome: 'success' as const };
  }
  const target = stringValue(config.url);
  if (!target) throw new Error('Webhook action requires a target URL.');
  const url = assertSafeUrl(context.renderTemplate(target));
  const method = stringValue(config.method)?.toUpperCase() || 'POST';
  const headers = parseHeaders(config.headers);
  const bearerToken = stringValue(context.settings.bearerToken);
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  const bodyTemplate = stringValue(config.body);
  if (bodyTemplate) {
    headers['Content-Type'] ||= 'application/json';
  }
  const retries = Math.min(Math.max(Number(config.retries) || 0, 0), 3);
  const timeoutMs = Math.min(
    Math.max(Number(config.timeoutMs) || 10_000, 1_000),
    30_000,
  );

  await context.log(`Sending ${method} webhook request.`, 'info');
  let lastStatus = 0;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([context.signal, timeout]);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body:
          bodyTemplate && !['GET', 'HEAD'].includes(method)
            ? context.renderTemplate(bodyTemplate)
            : undefined,
        redirect: 'error',
        signal,
      });
      lastStatus = response.status;
      const responseText = await response.text();
      if (!response.ok) {
        if (attempt < retries && response.status >= 500) continue;
        throw new Error(`Webhook returned HTTP ${response.status}.`);
      }
      await context.log('Webhook request completed successfully.', 'info');
      return {
        outcome: 'success' as const,
        output: {
          body: responseText.slice(0, MAX_RESPONSE_BYTES),
          status: response.status,
        },
      };
    } catch (error) {
      if (context.signal.aborted)
        throw new Error('Webhook request was cancelled.');
      if (attempt < retries) continue;
      const message =
        error instanceof Error && error.message.startsWith('Webhook returned')
          ? error.message
          : `Webhook request failed${lastStatus ? ` with HTTP ${lastStatus}` : ''}.`;
      throw new Error(message);
    }
  }
  throw new Error('Webhook request failed.');
}

export const webhooksOrchestratorContribution = {
  contractVersion: 1,
  id: 'webhooks',
  executors: [
    {
      default: true,
      execute: executeWebhook,
      nodeType: 'webhooks',
    },
  ],
} satisfies OrchestratorIntegrationContribution;

export default webhooksOrchestratorContribution;
