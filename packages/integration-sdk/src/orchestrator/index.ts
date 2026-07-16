export const ORCHESTRATOR_CONTRACT_VERSION = 1 as const;

export type OrchestratorContractVersion = typeof ORCHESTRATOR_CONTRACT_VERSION;

export type OrchestratorLogLevel =
  | 'info'
  | 'warn'
  | 'error'
  | 'build'
  | 'debug';

export interface OrchestratorNode {
  id: string;
  nodeType: string;
  config: Record<string, unknown>;
}

/**
 * Provider-scoped capabilities supplied by the orchestrator host.
 *
 * Integration executors deliberately do not receive event publishers, state
 * mutation helpers, transport credentials, or settings for other providers.
 */
export interface NodeExecutionContext {
  executionId: string;
  workflowId?: string;
  node: OrchestratorNode;
  settings: Readonly<Record<string, unknown>>;
  env: Readonly<Record<string, string>>;
  workflow: Readonly<Record<string, unknown>>;
  renderTemplate: (value: string) => string;
  log: (message: string, level?: OrchestratorLogLevel) => Promise<void>;
  signal: AbortSignal;
}

export interface NodeExecutionResult {
  outcome: 'success' | 'warning';
  output?: unknown;
}

export interface OrchestratorIntegrationExecutor {
  /** Persisted workflow node.nodeType / integration ID. */
  nodeType: string;
  /** Optional persisted node.config.action handled by this executor. */
  action?: string;
  /** Executor used when a node does not specify an action. */
  default?: boolean;
  validate?: (context: NodeExecutionContext) => void | Promise<void>;
  execute: (context: NodeExecutionContext) => Promise<NodeExecutionResult>;
}

export interface OrchestratorIntegrationContribution {
  contractVersion: OrchestratorContractVersion;
  id: string;
  executors: readonly OrchestratorIntegrationExecutor[];
}

export function createOrchestratorContribution<
  TContribution extends OrchestratorIntegrationContribution,
>(contribution: TContribution): TContribution {
  return contribution;
}
