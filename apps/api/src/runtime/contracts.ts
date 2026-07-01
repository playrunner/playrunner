import type { Request, Response } from 'express';

export type WorkflowRequestBody = Record<string, any>;

export interface WorkflowExecutionRequest {
  body: WorkflowRequestBody;
  req: Request;
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

export interface LogTransport {
  publish(payload: string): Promise<void>;
  setup(): Promise<void>;
}

export interface RunnerProvisionResult {
  body: Record<string, any>;
  status: number;
}

export interface RunnerProvisioner {
  start(cloudProvider?: string): Promise<RunnerProvisionResult>;
}

export interface WorkflowScheduleState {
  cron: string;
  enabled: boolean;
  gcpJobName?: string | null;
  id: string;
  provider: string;
  scheduleNodeId: string;
  timezone: string;
  userId: string;
  workflowId: string;
}

export interface SchedulerProvisionRequest {
  credentials: Record<string, any>;
  schedule: WorkflowScheduleState;
  triggerPayload: Record<string, any>;
  triggerUrl: string;
}

export interface SchedulerProvisionResult {
  gcpJobName?: string | null;
}

export interface SchedulerProvisioner {
  delete(request: SchedulerProvisionRequest): Promise<void>;
  pause(
    request: SchedulerProvisionRequest,
  ): Promise<SchedulerProvisionResult | void>;
  supports(provider: string): boolean;
  upsert(request: SchedulerProvisionRequest): Promise<SchedulerProvisionResult>;
}

export interface CloudProviderDefinition {
  id: string;
  label: string;
}

export interface CloudProviderRegistry {
  list(): CloudProviderDefinition[];
}

export interface ApiRuntimeContribution {
  cloudProviders?: CloudProviderDefinition[];
  outputProxyBackends?: OutputProxyBackend[];
  outputSyncBackends?: OutputSyncBackend[];
  schedulerProvisioners?: SchedulerProvisioner[];
  workflowExecutionBackends?: WorkflowExecutionBackend[];
}
