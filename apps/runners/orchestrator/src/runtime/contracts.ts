import type { ChildProcess } from 'child_process';

export interface AgentExecutionRequest {
  agent: { config: Record<string, unknown>; nodeType: string };
  config: Record<string, any>;
  envKeys: string[];
  globalEnvVars: Record<string, string>;
  nodeId: string;
  publishLog: (
    message: string,
    level?: 'info' | 'error' | 'warn' | 'build' | 'debug',
  ) => Promise<void>;
  registerActiveProcess: (nodeId: string, process: ChildProcess) => void;
  reqBody: any;
  validators: Array<{ config: Record<string, unknown>; nodeType: string }>;
}

export interface AgentExecutionResult {
  outcome: 'success' | 'error';
  output: Record<string, unknown>;
}

export interface PreparedAgentRunner {
  cancel?: () => Promise<void>;
  cleanup?: () => Promise<void>;
  start: () => Promise<void>;
  waitForCompletion: () => Promise<AgentExecutionResult>;
  waitUntilReady: () => Promise<void>;
}

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
  publishLog: (
    message: string,
    level?: 'info' | 'error' | 'warn' | 'build' | 'debug',
  ) => Promise<void>;
  registerActiveProcess: (nodeId: string, process: ChildProcess) => void;
  reqBody: any;
  runtime: 'typescript' | 'python';
}

export interface PreparedPlaywrightRunner {
  cancel?: () => Promise<void>;
  cleanup?: () => Promise<void>;
  start: () => Promise<void>;
  waitForCompletion: () => Promise<PlaywrightExecutionResult>;
  waitUntilReady: () => Promise<void>;
}

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
