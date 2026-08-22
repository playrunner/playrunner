import type { ChildProcess } from 'child_process';

export interface CiChangeContext {
  baseRef: string;
  baseSha: string;
  eventType: 'manual' | 'pull_request' | 'push';
  headRef: string;
  headSha: string;
  pullRequestNumber?: number;
  repository: string;
}

export interface AgentExecutionRequest {
  agent: { config: Record<string, unknown>; nodeId: string; nodeType: string };
  config: Record<string, unknown>;
  changeContext?: CiChangeContext;
  envKeys: string[];
  globalEnvVars: Record<string, string>;
  nodeId: string;
  nodeOutputs: Readonly<Record<string, unknown>>;
  memory?: Record<string, unknown>;
  publishEvent: (event: Record<string, unknown>) => Promise<void>;
  publishLog: (
    message: string,
    level?: 'info' | 'error' | 'warn' | 'build' | 'debug',
  ) => Promise<void>;
  registerActiveProcess: (nodeId: string, process: ChildProcess) => void;
  reqBody: any;
  runtime: {
    bucketName?: string;
    cloudProvider: string;
    editorApiUrl: string;
    executionAuthToken: string;
    nodeId: string;
    testId: string;
    workflowId: string;
  };
  validators: Array<{
    config: Record<string, unknown>;
    nodeId: string;
    nodeType: string;
  }>;
}

export interface AgentExecutionResult {
  diagnosticLogs?: Array<{
    level: 'info' | 'error';
    message: string;
    nodeId?: string;
    timestamp: string;
  }>;
  outcome: 'success' | 'error';
  output: Record<string, unknown>;
}

export interface PreparedIsolatedRunner<TResult> {
  cancel?: () => Promise<void>;
  cleanup?: () => Promise<void>;
  start: () => Promise<void>;
  waitForCompletion: () => Promise<TResult>;
  waitUntilReady: () => Promise<void>;
}

export type PreparedAgentRunner = PreparedIsolatedRunner<AgentExecutionResult>;

export interface AgentExecutionBackend {
  prepare(request: AgentExecutionRequest): Promise<PreparedAgentRunner>;
  supports(cloudProvider: string): boolean;
}

export interface PlaywrightExecutionRequest {
  config: Record<string, any>;
  envKeys: string[];
  globalEnvVars: Record<string, string>;
  nodeId: string;
  payloadData: any;
  publishEvent: (event: Record<string, unknown>) => Promise<void>;
  publishLog: (
    message: string,
    level?: 'info' | 'error' | 'warn' | 'build' | 'debug',
  ) => Promise<void>;
  registerActiveProcess: (nodeId: string, process: ChildProcess) => void;
  reqBody: any;
  runtime: 'typescript' | 'python';
}

export type PreparedPlaywrightRunner =
  PreparedIsolatedRunner<PlaywrightExecutionResult>;

export interface PlaywrightExecutionResult {
  diagnosticLogs?: Array<{
    level: 'info' | 'error';
    message: string;
    nodeId?: string;
    timestamp: string;
  }>;
  outcome: 'success' | 'error';
  output: Record<string, unknown>;
}

export interface PlaywrightExecutionBackend {
  execute(request: PlaywrightExecutionRequest): Promise<void>;
  prepare?(
    request: PlaywrightExecutionRequest,
  ): Promise<PreparedPlaywrightRunner>;
  supports(cloudProvider: string): boolean;
}

export interface OrchestratorRuntimeContribution {
  agentExecutionBackends?: AgentExecutionBackend[];
  playwrightExecutionBackends?: PlaywrightExecutionBackend[];
}
