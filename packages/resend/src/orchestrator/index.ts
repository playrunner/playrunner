import type {
  NodeExecutionContext,
  NodeExecutionResult,
  OrchestratorIntegrationContribution,
} from '@playrunner/integration-sdk/orchestrator';

const DEFAULT_API_BASE_URL = 'https://api.resend.com';

class ResendExecutionError extends Error {}

function apiBaseUrl() {
  return (process.env.RESEND_API_BASE_URL || DEFAULT_API_BASE_URL).replace(
    /\/+$/,
    '',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function integer(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ResendExecutionError(
      `Expected an integer between ${minimum} and ${maximum}.`,
    );
  }
  return parsed;
}

function credential(context: NodeExecutionContext) {
  const value =
    optionalString(context.settings.accessToken) ??
    optionalString(context.settings.apiKey);
  if (!value) {
    throw new ResendExecutionError(
      'Resend credentials are missing. Connect Resend before running.',
    );
  }
  return value;
}

function render(context: NodeExecutionContext, value: unknown) {
  const text = optionalString(value);
  return text ? context.renderTemplate(text).trim() : '';
}

function recipients(context: NodeExecutionContext, value: unknown) {
  const rendered = render(context, value);
  if (!rendered) return [];
  return rendered
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function jsonObject(
  context: NodeExecutionContext,
  value: unknown,
  label: string,
) {
  if (value === undefined || value === null || value === '') return undefined;
  if (isRecord(value)) return value;
  if (typeof value !== 'string') {
    throw new ResendExecutionError(`${label} must be a JSON object.`);
  }
  try {
    const parsed: unknown = JSON.parse(context.renderTemplate(value));
    if (!isRecord(parsed)) throw new Error('not an object');
    return parsed;
  } catch {
    throw new ResendExecutionError(`${label} must be a valid JSON object.`);
  }
}

function safeProviderCode(value: unknown) {
  const code = optionalString(value);
  return code && /^[a-z0-9_.-]{1,100}$/i.test(code) ? code : undefined;
}

async function resendJson(
  context: NodeExecutionContext,
  path: string,
  init: RequestInit = {},
) {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${credential(context)}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    signal: context.signal,
  });
  const data = (await response.json().catch(() => undefined)) as unknown;
  if (!response.ok) {
    const providerError =
      isRecord(data) && isRecord(data.error) ? data.error : data;
    const code = isRecord(providerError)
      ? (safeProviderCode(providerError.name) ??
        safeProviderCode(providerError.code) ??
        safeProviderCode(providerError.type))
      : undefined;
    throw new ResendExecutionError(
      `Resend API returned ${response.status}: request failed${code ? ` (${code})` : ''}.`,
    );
  }
  if (!isRecord(data)) {
    throw new ResendExecutionError('Resend returned an invalid response.');
  }
  return data;
}

function tagList(value: Record<string, unknown> | undefined) {
  if (!value) return undefined;
  return Object.entries(value).map(([name, entry]) => ({
    name,
    value: String(entry),
  }));
}

async function executeSend(
  context: NodeExecutionContext,
): Promise<NodeExecutionResult> {
  try {
    const config = context.node.config;
    const from = render(context, config.from);
    const to = recipients(context, config.to);
    const subject = render(context, config.subject);
    if (!from) throw new ResendExecutionError('From is required.');
    if (to.length === 0) throw new ResendExecutionError('To is required.');
    if (to.length > 50) {
      throw new ResendExecutionError('Resend supports at most 50 recipients.');
    }
    if (!subject) throw new ResendExecutionError('Subject is required.');

    const body: Record<string, unknown> = { from, to, subject };
    const contentMode = config.contentMode === 'template' ? 'template' : 'body';
    if (contentMode === 'template') {
      const templateId = render(context, config.templateId);
      if (!templateId) {
        throw new ResendExecutionError('Template ID or alias is required.');
      }
      const templateVariables = jsonObject(
        context,
        config.templateVariables,
        'Template variables',
      );
      body.template = {
        id: templateId,
        ...(templateVariables ? { variables: templateVariables } : {}),
      };
    } else {
      const text = render(context, config.text);
      const html = render(context, config.html);
      if (!text && !html) {
        throw new ResendExecutionError(
          'Plain text or HTML content is required.',
        );
      }
      if (text) body.text = text;
      if (html) body.html = html;
    }

    const cc = recipients(context, config.cc);
    const bcc = recipients(context, config.bcc);
    const replyTo = recipients(context, config.replyTo);
    if (cc.length) body.cc = cc;
    if (bcc.length) body.bcc = bcc;
    if (replyTo.length) body.reply_to = replyTo;
    const tags = tagList(jsonObject(context, config.tags, 'Tags'));
    if (tags?.length) body.tags = tags;
    const headers = jsonObject(context, config.headers, 'Custom headers');
    if (headers) body.headers = headers;

    const idempotencyKey =
      render(context, config.idempotencyKey) ||
      `${context.executionId}:${context.node.id}`;
    await context.log('Sending email with Resend...', 'info');
    const result = await resendJson(context, '/emails', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    });
    const emailId = optionalString(result.id);
    if (!emailId) {
      throw new ResendExecutionError('Resend returned no email ID.');
    }
    await context.log('Resend accepted the email.', 'info');
    return {
      outcome: 'success',
      output: { result: { status: 'success', emailId } },
    };
  } catch (error) {
    const message =
      error instanceof ResendExecutionError
        ? error.message
        : context.signal.aborted
          ? 'Resend request was cancelled.'
          : 'Resend request failed.';
    throw new Error(`Resend Send Email failed: ${message}`);
  }
}

interface ReceivedEmailSummary extends Record<string, unknown> {
  id: string;
  created_at: string;
  from: string;
  subject: string;
  to: string[];
}

function receivedSummaries(value: unknown): ReceivedEmailSummary[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ReceivedEmailSummary => {
    return (
      isRecord(entry) &&
      typeof entry.id === 'string' &&
      typeof entry.created_at === 'string' &&
      typeof entry.from === 'string' &&
      typeof entry.subject === 'string' &&
      Array.isArray(entry.to) &&
      entry.to.every((address) => typeof address === 'string')
    );
  });
}

function stripHtml(value: string) {
  return value
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractVerificationCode(value: string) {
  const candidates = new Set<string>();
  const contextual =
    /(?:verification|security|one[- ]time|otp|passcode|code)(?:\s+code)?\s*(?:is|:|-)?\s*([a-z0-9]{4,8})\b/gi;
  for (const match of value.matchAll(contextual)) {
    if (match[1]) candidates.add(match[1]);
  }
  if (candidates.size === 0) {
    for (const match of value.matchAll(/\b(\d{4,8})\b/g)) {
      if (match[1]) candidates.add(match[1]);
    }
  }
  const matches = [...candidates];
  return {
    status:
      matches.length === 0
        ? ('not_found' as const)
        : matches.length === 1
          ? ('matched' as const)
          : ('ambiguous' as const),
    value: matches.length === 1 ? matches[0] : null,
  };
}

function extractValue(config: Record<string, unknown>, content: string) {
  if (config.extraction === 'none') {
    return { type: 'none', status: 'disabled', value: null };
  }
  if (config.extraction === 'custom') {
    const source = optionalString(config.extractionPattern);
    if (!source) {
      throw new ResendExecutionError(
        'Extraction regular expression is required.',
      );
    }
    let expression: RegExp;
    try {
      expression = new RegExp(source, 'i');
    } catch {
      throw new ResendExecutionError(
        'Extraction regular expression is invalid.',
      );
    }
    const group = integer(config.captureGroup, 1, 0, 20);
    const match = expression.exec(content);
    return {
      type: 'custom',
      status: match?.[group] ? 'matched' : 'not_found',
      value: match?.[group] ?? null,
    };
  }
  return { type: 'verification_code', ...extractVerificationCode(content) };
}

function matchesSummary(
  summary: ReceivedEmailSummary,
  input: {
    from: string;
    minimumTime: number;
    subject: string;
    to: string;
  },
) {
  const createdAt = Date.parse(summary.created_at);
  if (!Number.isFinite(createdAt) || createdAt < input.minimumTime)
    return false;
  const addresses = summary.to.map((address) => address.toLowerCase());
  if (!addresses.includes(input.to.toLowerCase())) return false;
  if (input.subject && !summary.subject.toLowerCase().includes(input.subject)) {
    return false;
  }
  if (input.from) {
    const sender = summary.from.toLowerCase();
    if (
      input.from.startsWith('@')
        ? !sender.endsWith(input.from)
        : sender !== input.from
    ) {
      return false;
    }
  }
  return true;
}

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('cancelled'));
      return;
    }
    const finish = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timeout = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timeout);
      reject(signal.reason ?? new Error('cancelled'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function attachments(
  context: NodeExecutionContext,
  emailId: string,
  email: Record<string, unknown>,
) {
  if (context.node.config.attachments === 'none') return [];
  const summaries = Array.isArray(email.attachments)
    ? email.attachments.filter(isRecord)
    : [];
  const limited = summaries.slice(0, 20);
  return Promise.all(
    limited.map(async (summary) => {
      const id = optionalString(summary.id);
      if (!id) return summary;
      const detail = await resendJson(
        context,
        `/emails/receiving/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(id)}`,
      );
      return {
        id,
        filename: optionalString(detail.filename) ?? 'attachment',
        contentType:
          optionalString(detail.content_type) ?? 'application/octet-stream',
        size: typeof detail.size === 'number' ? detail.size : undefined,
        contentDisposition: optionalString(detail.content_disposition),
        contentId: optionalString(detail.content_id),
        downloadUrl: optionalString(detail.download_url),
        expiresAt: optionalString(detail.expires_at),
      };
    }),
  );
}

async function executeWait(
  context: NodeExecutionContext,
): Promise<NodeExecutionResult> {
  try {
    const config = context.node.config;
    const to = render(context, config.to);
    if (!to) throw new ResendExecutionError('Recipient is required.');
    const timeoutSeconds = integer(config.timeoutSeconds, 120, 5, 240);
    const pollSeconds = integer(config.pollSeconds, 3, 1, 30);
    const lookbackSeconds = integer(config.lookbackSeconds, 30, 0, 300);
    const from = render(context, config.fromFilter).toLowerCase();
    const subject = render(context, config.subjectFilter).toLowerCase();
    const bodyFilter = render(context, config.bodyFilter).toLowerCase();
    if (config.extraction === 'custom') {
      extractValue(config, '');
    }

    const startedAt = Date.now();
    const deadline = startedAt + timeoutSeconds * 1000;
    const minimumTime = startedAt - lookbackSeconds * 1000;
    const inspected = new Set<string>();
    await context.log('Waiting for a matching Resend email...', 'info');

    while (Date.now() < deadline) {
      const list = await resendJson(context, '/emails/receiving?limit=100');
      const candidates = receivedSummaries(list.data)
        .filter((summary) => !inspected.has(summary.id))
        .filter((summary) =>
          matchesSummary(summary, { from, minimumTime, subject, to }),
        )
        .sort(
          (left, right) =>
            Date.parse(left.created_at) - Date.parse(right.created_at),
        );

      for (const summary of candidates) {
        inspected.add(summary.id);
        const email = await resendJson(
          context,
          `/emails/receiving/${encodeURIComponent(summary.id)}`,
        );
        const text = optionalString(email.text) ?? '';
        const html = optionalString(email.html) ?? '';
        const searchable = `${text}\n${stripHtml(html)}`.trim();
        if (bodyFilter && !searchable.toLowerCase().includes(bodyFilter)) {
          continue;
        }

        const extraction = extractValue(config, searchable);
        const receivedAttachments = await attachments(
          context,
          summary.id,
          email,
        );
        await context.log('A matching Resend email was received.', 'info');
        return {
          outcome: 'success',
          output: {
            result: {
              status: 'matched',
              email: {
                id: summary.id,
                from: summary.from,
                to: summary.to,
                subject: summary.subject,
                createdAt: summary.created_at,
                text: email.text ?? null,
                html: email.html ?? null,
                headers: isRecord(email.headers) ? email.headers : {},
                messageId: optionalString(email.message_id) ?? null,
              },
              extraction,
              attachments: receivedAttachments,
            },
          },
        };
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await abortableDelay(
        Math.min(pollSeconds * 1000, remaining),
        context.signal,
      );
    }
    throw new ResendExecutionError(
      `No matching email arrived within ${timeoutSeconds} seconds.`,
    );
  } catch (error) {
    const message =
      error instanceof ResendExecutionError
        ? error.message
        : context.signal.aborted
          ? 'Wait for Email was cancelled.'
          : 'Wait for Email failed.';
    throw new Error(`Resend Wait for Email failed: ${message}`);
  }
}

export const resendOrchestratorContribution = {
  contractVersion: 1,
  id: 'resend',
  executors: [
    {
      nodeType: 'resend',
      action: 'send',
      default: true,
      execute: executeSend,
    },
    {
      nodeType: 'resend',
      action: 'wait',
      execute: executeWait,
    },
  ],
} satisfies OrchestratorIntegrationContribution;

export default resendOrchestratorContribution;
