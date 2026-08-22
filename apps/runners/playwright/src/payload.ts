import type { Readable } from 'node:stream';
import { selectExecutionEnvironment } from '../../shared/execution-environment';

export const MAX_PLAYWRIGHT_PAYLOAD_BYTES = 10 * 1024 * 1024;

export function readPlaywrightExecutionEnvironment(
  payload: Record<string, any>,
): Record<string, string> {
  const value = payload?.data?.environment;
  if (
    value !== undefined &&
    (!value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.values(value).some((entry) => typeof entry !== 'string'))
  ) {
    throw new Error('PAYLOAD.data.environment must contain string values.');
  }

  const environment = (value || {}) as Record<string, string>;
  return selectExecutionEnvironment(
    Object.keys(environment),
    environment,
    'Playwright Environment',
  );
}

async function readBounded(input: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    bytes += buffer.length;
    if (bytes > MAX_PLAYWRIGHT_PAYLOAD_BYTES) {
      throw new Error(
        `Playwright runner payload exceeds ${MAX_PLAYWRIGHT_PAYLOAD_BYTES} bytes.`,
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function readPlaywrightPayload(
  options: {
    environment?: NodeJS.ProcessEnv;
    input?: Readable;
  } = {},
): Promise<Record<string, any>> {
  const environment = options.environment || process.env;
  const environmentPayload = environment.PAYLOAD;
  // PAYLOAD contains repository and transport credentials in Cloud Run. Keep
  // it in runner memory only; repository-controlled children inherit env.
  delete environment.PAYLOAD;
  const raw =
    environmentPayload ?? (await readBounded(options.input || process.stdin));
  if (!raw.trim()) {
    throw new Error('Playwright runner payload is required.');
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_PLAYWRIGHT_PAYLOAD_BYTES) {
    throw new Error(
      `Playwright runner payload exceeds ${MAX_PLAYWRIGHT_PAYLOAD_BYTES} bytes.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Playwright runner payload is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Playwright runner payload must be an object.');
  }
  return parsed as Record<string, any>;
}
