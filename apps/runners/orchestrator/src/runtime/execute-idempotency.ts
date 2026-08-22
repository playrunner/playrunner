import { createHash } from 'node:crypto';

export const DEFAULT_EXECUTE_IDEMPOTENCY_MAX_ENTRIES = 1_000;
export const DEFAULT_EXECUTE_TERMINAL_RETENTION_MS = 24 * 60 * 60 * 1_000;

type ExecuteEntry = {
  payloadHash: string;
  reservedAt: number;
  state: 'running' | 'terminal';
  terminalAt?: number;
};

type ExecuteReservation =
  | {
      executionId: string;
      kind: 'capacity';
    }
  | {
      executionId: string;
      kind: 'conflict';
    }
  | {
      executionId: string;
      kind: 'duplicate';
      state: ExecuteEntry['state'];
    }
  | {
      kind: 'invalid';
      message: string;
    }
  | {
      executionId: string;
      kind: 'reserved';
      payloadHash: string;
    };

export type ExecuteAdmission = {
  body: Record<string, unknown>;
  start?: () => Promise<void>;
  statusCode: number;
};

function canonicalJson(value: unknown, ancestors = new Set<object>()): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Execute payload numbers must be finite.');
    }
    return JSON.stringify(value);
  }

  if (typeof value !== 'object') {
    throw new Error('Execute payload must contain only JSON values.');
  }

  if (ancestors.has(value)) {
    throw new Error('Execute payload must not contain circular references.');
  }
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => canonicalJson(item, ancestors)).join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('Execute payload must contain only JSON objects.');
    }

    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(
            (value as Record<string, unknown>)[key],
            ancestors,
          )}`,
      )
      .join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalExecutePayloadHash(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

function getExactExecutionId(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Execute payload must be a JSON object.');
  }

  const testId = (payload as Record<string, unknown>).testId;
  const hasControlCharacter =
    typeof testId === 'string' &&
    Array.from(testId).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    });
  if (
    typeof testId !== 'string' ||
    testId.length === 0 ||
    testId.length > 256 ||
    testId !== testId.trim() ||
    hasControlCharacter
  ) {
    throw new Error(
      'Execute payload testId must be a non-empty normalized string of at most 256 characters.',
    );
  }

  const executionId = (payload as Record<string, unknown>).executionId;
  if (executionId !== undefined && executionId !== testId) {
    throw new Error(
      'Execute payload executionId must exactly match testId when provided.',
    );
  }

  return testId;
}

export class ExecuteIdempotencyRegistry {
  private readonly entries = new Map<string, ExecuteEntry>();
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly terminalRetentionMs: number;

  constructor({
    maxEntries = DEFAULT_EXECUTE_IDEMPOTENCY_MAX_ENTRIES,
    now = Date.now,
    terminalRetentionMs = DEFAULT_EXECUTE_TERMINAL_RETENTION_MS,
  }: {
    maxEntries?: number;
    now?: () => number;
    terminalRetentionMs?: number;
  } = {}) {
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
      throw new Error('Execute idempotency maxEntries must be positive.');
    }
    if (!Number.isFinite(terminalRetentionMs) || terminalRetentionMs < 0) {
      throw new Error(
        'Execute idempotency terminalRetentionMs must be non-negative.',
      );
    }
    this.maxEntries = maxEntries;
    this.now = now;
    this.terminalRetentionMs = terminalRetentionMs;
  }

  get entryCount(): number {
    return this.entries.size;
  }

  reserve(payload: unknown): ExecuteReservation {
    let executionId: string;
    let payloadHash: string;
    try {
      executionId = getExactExecutionId(payload);
      payloadHash = canonicalExecutePayloadHash(payload);
    } catch (error) {
      return {
        kind: 'invalid',
        message:
          error instanceof Error ? error.message : 'Invalid execute payload.',
      };
    }

    const now = this.now();
    this.pruneExpiredTerminals(now);

    const existing = this.entries.get(executionId);
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        return { executionId, kind: 'conflict' };
      }
      return { executionId, kind: 'duplicate', state: existing.state };
    }

    this.evictOldestTerminalsForCapacity();
    if (this.entries.size >= this.maxEntries) {
      return { executionId, kind: 'capacity' };
    }

    this.entries.set(executionId, {
      payloadHash,
      reservedAt: now,
      state: 'running',
    });
    return { executionId, kind: 'reserved', payloadHash };
  }

  markTerminal(executionId: string, payloadHash: string): void {
    const entry = this.entries.get(executionId);
    if (!entry || entry.payloadHash !== payloadHash) {
      return;
    }

    entry.state = 'terminal';
    entry.terminalAt = this.now();
  }

  private evictOldestTerminalsForCapacity(): void {
    while (this.entries.size >= this.maxEntries) {
      let oldest: { executionId: string; terminalAt: number } | undefined;
      for (const [executionId, entry] of this.entries) {
        if (entry.state !== 'terminal') continue;
        const terminalAt = entry.terminalAt ?? entry.reservedAt;
        if (!oldest || terminalAt < oldest.terminalAt) {
          oldest = { executionId, terminalAt };
        }
      }
      if (!oldest) return;
      this.entries.delete(oldest.executionId);
    }
  }

  private pruneExpiredTerminals(now: number): void {
    for (const [executionId, entry] of this.entries) {
      if (
        entry.state === 'terminal' &&
        entry.terminalAt !== undefined &&
        now - entry.terminalAt >= this.terminalRetentionMs
      ) {
        this.entries.delete(executionId);
      }
    }
  }
}

export class ExecuteRequestCoordinator {
  constructor(
    private readonly execute: (
      payload: Record<string, unknown>,
    ) => Promise<void>,
    private readonly onExecutionError: (error: unknown) => void,
    private readonly registry = new ExecuteIdempotencyRegistry(),
  ) {}

  admit(payload: unknown): ExecuteAdmission {
    const reservation = this.registry.reserve(payload);
    if (reservation.kind === 'invalid') {
      return {
        body: { error: reservation.message },
        statusCode: 400,
      };
    }
    if (reservation.kind === 'conflict') {
      return {
        body: {
          error:
            'An execution with this testId was already admitted with a different payload.',
          testId: reservation.executionId,
        },
        statusCode: 409,
      };
    }
    if (reservation.kind === 'capacity') {
      return {
        body: {
          error: 'Orchestrator execution admission capacity is exhausted.',
          testId: reservation.executionId,
        },
        statusCode: 409,
      };
    }
    if (reservation.kind === 'duplicate') {
      return {
        body: {
          executionState: reservation.state,
          status: 'already_started',
          testId: reservation.executionId,
        },
        statusCode: 200,
      };
    }

    const admittedPayload = payload as Record<string, unknown>;
    let started: Promise<void> | undefined;
    return {
      body: { status: 'started', testId: reservation.executionId },
      start: () => {
        if (started) return started;
        started = (async () => {
          try {
            await this.execute(admittedPayload);
          } catch (error) {
            try {
              this.onExecutionError(error);
            } catch {
              // A logging failure must not leave the admission marked running.
            }
          } finally {
            this.registry.markTerminal(
              reservation.executionId,
              reservation.payloadHash,
            );
          }
        })();
        return started;
      },
      statusCode: 200,
    };
  }
}
