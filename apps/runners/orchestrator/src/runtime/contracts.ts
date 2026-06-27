import type { ChildProcess } from 'child_process';

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
  cleanup?: () => Promise<void>;
  start: () => Promise<void>;
  waitForCompletion: () => Promise<void>;
  waitUntilReady: () => Promise<void>;
}

export interface PlaywrightExecutionBackend {
  execute(request: PlaywrightExecutionRequest): Promise<void>;
  prepare?(
    request: PlaywrightExecutionRequest,
  ): Promise<PreparedPlaywrightRunner>;
  supports(cloudProvider: string): boolean;
}

export interface OrchestratorRuntimeContribution {
  playwrightExecutionBackends?: PlaywrightExecutionBackend[];
}
