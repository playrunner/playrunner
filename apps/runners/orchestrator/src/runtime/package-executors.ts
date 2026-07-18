import {
  type OrchestratorRegistry,
  type OrchestratorContributionDiagnostic,
} from './orchestrator-registry';
import type {
  NodeExecutionContext,
  NodeExecutionResult,
  OrchestratorLogLevel,
  OrchestratorNode,
} from '@playrunner/integration-sdk/orchestrator';
import { packageOrchestratorRegistry } from './discovered-orchestrator-registry';

const DEFAULT_EXECUTOR_TIMEOUT_MS = 5 * 60 * 1000;

export const HOST_MANAGED_NODE_TYPES = Object.freeze([
  'environment',
  'github',
  'playwright',
  'schedule',
] as const);

const hostManagedNodeTypes = new Set<string>(HOST_MANAGED_NODE_TYPES);

export interface PersistedWorkflowNode {
  id?: unknown;
  label?: unknown;
  nodeType?: unknown;
  config?: unknown;
}

export interface PackageExecutorRuntimeOptions {
  registry?: OrchestratorRegistry;
  timeoutMs?: number;
}

export interface PackageNodeExecutionInput {
  executionId: string;
  workflowId?: string;
  node: PersistedWorkflowNode;
  settings: unknown;
  env: Readonly<Record<string, string>>;
  workflow: Readonly<Record<string, unknown>>;
  renderTemplate: (value: string) => string;
  log: (message: string, level?: OrchestratorLogLevel) => Promise<void>;
}

export interface PackageExecutorRuntimeDiagnostics {
  activeExecutions: readonly {
    contributionId: string;
    executionId: string;
    nodeId: string;
    nodeType: string;
  }[];
  contributions: readonly OrchestratorContributionDiagnostic[];
  timeoutMs: number;
}

interface ActivePackageExecution {
  contributionId: string;
  controller: AbortController;
  executionId: string;
  nodeId: string;
  nodeType: string;
}

interface ResolvedNodeTarget {
  action?: string;
  config: Record<string, unknown>;
  nodeId: string;
  nodeType: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}

function nodeDescription(node: PersistedWorkflowNode): string {
  const label = nonEmptyString(node.label);
  const id = nonEmptyString(node.id);

  if (label && id) {
    return `"${label}" (${id})`;
  }

  return id ? `"${id}"` : label ? `"${label}"` : 'at an unknown position';
}

function getResolvedNodeTarget(
  node: PersistedWorkflowNode,
): ResolvedNodeTarget {
  const nodeId = nonEmptyString(node.id);
  if (!nodeId) {
    throw new Error(
      `Workflow node ${nodeDescription(node)} is missing a persisted id.`,
    );
  }

  const nodeType = nonEmptyString(node.nodeType);
  if (!nodeType) {
    throw new Error(
      `Workflow node ${nodeDescription(node)} is missing its persisted nodeType. Executor resolution does not fall back to the display label.`,
    );
  }

  const config = isRecord(node.config) ? node.config : {};
  const rawAction = config.action;
  let action: string | undefined;

  if (rawAction !== undefined && rawAction !== null && rawAction !== '') {
    action = nonEmptyString(rawAction);
    if (!action) {
      throw new Error(
        `Workflow node ${nodeDescription(node)} has an invalid config.action. Expected a non-empty string.`,
      );
    }
  }

  return { action, config, nodeId, nodeType };
}

function missingExecutorError(
  node: PersistedWorkflowNode,
  target: ResolvedNodeTarget,
): Error {
  const actionDescription = target.action
    ? ` and action "${target.action}"`
    : '';

  return new Error(
    `Orchestrator executor not installed/registered for node type "${target.nodeType}"${actionDescription} on workflow node ${nodeDescription(node)}. Rebuild and redeploy the orchestrator with a package that registers this executor.`,
  );
}

function executionKey(executionId: string, nodeId: string): string {
  return JSON.stringify([executionId, nodeId]);
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object') {
    return value;
  }

  const object = value as object;
  if (seen.has(object)) {
    return value;
  }

  seen.add(object);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child, seen);
  }

  return Object.freeze(value);
}

function readonlySnapshot<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Node executor was cancelled.');
}

function assertExecutionResult(
  result: unknown,
  contributionId: string,
): asserts result is NodeExecutionResult {
  if (
    !isRecord(result) ||
    (result.outcome !== 'success' && result.outcome !== 'warning')
  ) {
    throw new Error(
      `Orchestrator executor from contribution "${contributionId}" returned an invalid result.`,
    );
  }
}

function configuredExecutorTimeoutMs(): number {
  const configured = process.env.ORCHESTRATOR_EXECUTOR_TIMEOUT_MS?.trim();
  if (!configured) {
    return DEFAULT_EXECUTOR_TIMEOUT_MS;
  }

  const parsed = Number(configured);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(
      'ORCHESTRATOR_EXECUTOR_TIMEOUT_MS must be a positive integer.',
    );
  }

  return parsed;
}

export class PackageExecutorRuntime {
  private readonly registry: OrchestratorRegistry;
  private readonly timeoutMs: number;
  private readonly activeExecutions = new Map<string, ActivePackageExecution>();

  constructor(options: PackageExecutorRuntimeOptions = {}) {
    this.registry = options.registry ?? packageOrchestratorRegistry;
    this.timeoutMs = options.timeoutMs ?? configuredExecutorTimeoutMs();

    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error('Package executor timeout must be a positive integer.');
    }
  }

  preflight(nodes: readonly PersistedWorkflowNode[]): void {
    for (const node of nodes) {
      const target = getResolvedNodeTarget(node);
      if (hostManagedNodeTypes.has(target.nodeType)) {
        continue;
      }

      if (!this.registry.resolve(target.nodeType, target.action)) {
        throw missingExecutorError(node, target);
      }
    }
  }

  isHostManaged(node: PersistedWorkflowNode): boolean {
    return hostManagedNodeTypes.has(getResolvedNodeTarget(node).nodeType);
  }

  nodeType(node: PersistedWorkflowNode): string {
    return getResolvedNodeTarget(node).nodeType;
  }

  async execute(
    input: PackageNodeExecutionInput,
  ): Promise<NodeExecutionResult> {
    const target = getResolvedNodeTarget(input.node);
    const resolved = this.registry.resolve(target.nodeType, target.action);
    if (!resolved) {
      throw missingExecutorError(input.node, target);
    }

    const key = executionKey(input.executionId, target.nodeId);
    if (this.activeExecutions.has(key)) {
      throw new Error(
        `Orchestrator executor is already active for execution "${input.executionId}" and node "${target.nodeId}".`,
      );
    }

    const allSettings = isRecord(input.settings) ? input.settings : {};
    const scopedSettings = allSettings[resolved.contributionId];
    const providerSettings = isRecord(scopedSettings) ? scopedSettings : {};
    const controller = new AbortController();
    const activeExecution: ActivePackageExecution = {
      contributionId: resolved.contributionId,
      controller,
      executionId: input.executionId,
      nodeId: target.nodeId,
      nodeType: target.nodeType,
    };

    const context: NodeExecutionContext = {
      executionId: input.executionId,
      ...(input.workflowId ? { workflowId: input.workflowId } : {}),
      node: readonlySnapshot({
        id: target.nodeId,
        nodeType: target.nodeType,
        config: target.config,
      } satisfies OrchestratorNode),
      settings: readonlySnapshot(providerSettings),
      env: readonlySnapshot(input.env),
      workflow: readonlySnapshot(input.workflow),
      renderTemplate: input.renderTemplate,
      log: input.log,
      signal: controller.signal,
    };
    this.activeExecutions.set(key, activeExecution);

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let rejectOnAbort: (() => void) | undefined;

    try {
      const aborted = new Promise<never>((_, reject) => {
        rejectOnAbort = () => reject(abortError(controller.signal));
        controller.signal.addEventListener('abort', rejectOnAbort, {
          once: true,
        });
      });

      timeout = setTimeout(() => {
        controller.abort(
          new Error(`Node executor timed out after ${this.timeoutMs}ms.`),
        );
      }, this.timeoutMs);
      timeout.unref?.();

      const execution = (async () => {
        await resolved.executor.validate?.(context);
        return resolved.executor.execute(context);
      })();
      const result = await Promise.race([execution, aborted]);
      assertExecutionResult(result, resolved.contributionId);
      return result;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (rejectOnAbort) {
        controller.signal.removeEventListener('abort', rejectOnAbort);
      }
      if (this.activeExecutions.get(key) === activeExecution) {
        this.activeExecutions.delete(key);
      }
    }
  }

  cancel(args: { executionId: string; nodeId: string }): number {
    let cancelled = 0;

    for (const active of this.activeExecutions.values()) {
      if (
        active.nodeId !== args.nodeId ||
        active.executionId !== args.executionId
      ) {
        continue;
      }

      if (!active.controller.signal.aborted) {
        active.controller.abort(new Error('Node executor was cancelled.'));
        cancelled++;
      }
    }

    return cancelled;
  }

  diagnostics(): PackageExecutorRuntimeDiagnostics {
    return {
      activeExecutions: Array.from(
        this.activeExecutions.values(),
        (active) => ({
          contributionId: active.contributionId,
          executionId: active.executionId,
          nodeId: active.nodeId,
          nodeType: active.nodeType,
        }),
      ),
      contributions: this.registry.diagnostics,
      timeoutMs: this.timeoutMs,
    };
  }
}

export const packageExecutorRuntime = new PackageExecutorRuntime();
