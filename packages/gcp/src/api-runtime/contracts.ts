import type { Request, Response } from 'express';

export type GcpCredentialState = {
  accessToken: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  expiresAt?: number;
  selectedProject?: string;
};

export interface GcpRuntimeState {
  gcpCredentials: Record<string, GcpCredentialState>;
  testBucketNames: Record<string, string>;
  testCloudProviders: Record<string, string>;
}

export interface GcpExecutionEvents {
  appendEvent(
    executionId: string,
    event: Record<string, unknown>,
  ): Promise<unknown>;
  createExecution(params: {
    cloudProvider: string;
    executionId: string;
    userId: string;
    workflowId?: string | null;
  }): Promise<{
    execution: unknown;
    executionToken: string;
  }>;
  verifyExecutionToken(
    executionId: string,
    token: string,
  ): Promise<{ id: string } | null>;
}

export interface LogTransport {
  publish(payload: string): Promise<void>;
  setup(): Promise<void>;
}

export interface WorkflowExecutionRequest {
  body: Record<string, any>;
  req: Request & {
    authUser?: {
      providerUserId: string;
    };
  };
  testId: string;
}

export interface WorkflowExecutionResult {
  body: Record<string, any>;
  status: number;
}

export interface WorkflowExecutionBackend {
  execute(request: WorkflowExecutionRequest): Promise<WorkflowExecutionResult>;
  supports(cloudProvider: string): boolean;
}

export interface OutputSyncRequest {
  bucketName?: string;
  cloudProvider: string;
  nodeId: string;
  outputsDir: string;
  testId: string;
}

export interface OutputSyncBackend {
  sync(request: OutputSyncRequest): Promise<void>;
}

export interface OutputProxyBackend {
  tryHandle(req: Request, res: Response): Promise<boolean>;
}

export interface CloudProviderDefinition {
  id: string;
  label: string;
}

export interface ApiRuntimeContribution {
  cloudProviders?: CloudProviderDefinition[];
  outputProxyBackends?: OutputProxyBackend[];
  outputSyncBackends?: OutputSyncBackend[];
  workflowExecutionBackends?: WorkflowExecutionBackend[];
}
